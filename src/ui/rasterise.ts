/**
 * WMF/EMF → PNG in the browser. rtf.js's WMF/EMF renderers draw SVG with the DOM, so this runs
 * on the main thread: metafile → SVG → <img> → <canvas> → PNG bytes. Everything stays local.
 */
import type { EmbeddedPicture, OutputFile, RescueResult } from '../core/types';

interface MetafileRenderer {
  render(settings: Record<string, string | number>): SVGElement;
}
type RendererCtor = new (blob: ArrayBuffer) => MetafileRenderer;

let renderers: Promise<{ wmf: RendererCtor; emf: RendererCtor }> | undefined;

/** The UMD bundles may arrive as the namespace itself or under `default`, depending on the bundler. */
function pickRenderer(mod: unknown): RendererCtor {
  const candidate = mod as { Renderer?: RendererCtor; default?: { Renderer?: RendererCtor } };
  const ctor = candidate.Renderer ?? candidate.default?.Renderer;
  if (!ctor) throw new Error('Metafile renderer not found');
  return ctor;
}

function loadRenderers(): Promise<{ wmf: RendererCtor; emf: RendererCtor }> {
  renderers ??= Promise.all([import('rtf.js/dist/WMFJS.bundle.js'), import('rtf.js/dist/EMFJS.bundle.js')]).then(([wmf, emf]) => ({
    wmf: pickRenderer(wmf),
    emf: pickRenderer(emf),
  }));
  return renderers;
}

const MAX_SIDE = 2000;
const MIN_SIDE = 512;
const MM_ANISOTROPIC = 8;

export interface MetafileSize {
  widthPx: number;
  heightPx: number;
  xExt: number;
  yExt: number;
}

/** Reads the picture size from a placeable WMF header (key 0x9AC6CDD7), if present. */
export function wmfSize(bytes: Uint8Array): MetafileSize {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 22 && view.getUint32(0, true) === 0x9ac6cdd7) {
    const left = view.getInt16(6, true);
    const top = view.getInt16(8, true);
    const right = view.getInt16(10, true);
    const bottom = view.getInt16(12, true);
    const inch = view.getUint16(14, true) || 1440;
    const xExt = Math.abs(right - left) || 1000;
    const yExt = Math.abs(bottom - top) || 1000;
    return clampSize({ widthPx: (xExt / inch) * 96, heightPx: (yExt / inch) * 96, xExt, yExt });
  }
  return clampSize({ widthPx: 400, heightPx: 300, xExt: 1000, yExt: 750 });
}

/** Reads rclBounds from an EMF header (device units). */
export function emfSize(bytes: Uint8Array): MetafileSize {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 40 && view.getUint32(0, true) === 1) {
    const width = Math.abs(view.getInt32(16, true) - view.getInt32(8, true));
    const height = Math.abs(view.getInt32(20, true) - view.getInt32(12, true));
    if (width > 0 && height > 0) return clampSize({ widthPx: width, heightPx: height, xExt: width, yExt: height });
  }
  return clampSize({ widthPx: 400, heightPx: 300, xExt: 400, yExt: 300 });
}

/** Metafiles are vector drawings: render at 2× (at least MIN_SIDE on the long side), capped at MAX_SIDE. */
function clampSize(size: MetafileSize): MetafileSize {
  const longest = Math.max(size.widthPx, size.heightPx, 1);
  const scale = Math.min(MAX_SIDE / longest, Math.max(2, MIN_SIDE / longest));
  return {
    ...size,
    widthPx: Math.max(1, Math.round(size.widthPx * scale)),
    heightPx: Math.max(1, Math.round(size.heightPx * scale)),
  };
}

function svgToPng(svg: SVGElement, width: number, height: number): Promise<Uint8Array | undefined> {
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  const markup = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve(undefined);
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob(async (blob) => resolve(blob ? new Uint8Array(await blob.arrayBuffer()) : undefined), 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    img.src = url;
  });
}

/** Converts one WMF/EMF picture to PNG bytes, or undefined if it can't be drawn. */
export async function rasteriseMetafile(picture: EmbeddedPicture): Promise<Uint8Array | undefined> {
  if (picture.kind !== 'wmf' && picture.kind !== 'emf') return undefined;
  try {
    const { wmf, emf } = await loadRenderers();
    const buffer = picture.bytes.slice().buffer as ArrayBuffer;
    if (picture.kind === 'wmf') {
      const size = wmfSize(picture.bytes);
      const svg = new wmf(buffer).render({ width: `${size.widthPx}px`, height: `${size.heightPx}px`, xExt: size.xExt, yExt: size.yExt, mapMode: MM_ANISOTROPIC });
      return await svgToPng(svg, size.widthPx, size.heightPx);
    }
    const size = emfSize(picture.bytes);
    const svg = new emf(buffer).render({
      width: `${size.widthPx}px`,
      height: `${size.heightPx}px`,
      wExt: size.xExt,
      hExt: size.yExt,
      xExt: size.xExt,
      yExt: size.yExt,
      mapMode: MM_ANISOTROPIC,
    });
    return await svgToPng(svg, size.widthPx, size.heightPx);
  } catch {
    return undefined;
  }
}

const PENDING_WARNING = /picture\(s\) in WMF\/EMF form need the browser to convert them to PNG\./;

/**
 * Converts the WMF/EMF pictures the worker couldn't, using the same naming as the core
 * (`<base> - picture N.png`), and replaces the core's "needs the browser" warning with the outcome.
 */
export async function rasteriseResultPictures(result: RescueResult, base: string): Promise<{ outputs: OutputFile[]; warnings: string[] }> {
  const pictures = result.pictures ?? [];
  const outputs: OutputFile[] = [];
  const warnings = result.warnings.filter((w) => !PENDING_WARNING.test(w));
  const standalone = result.detected.family === 'image';
  for (const [index, picture] of pictures.entries()) {
    if (picture.kind !== 'wmf' && picture.kind !== 'emf') continue;
    const png = await rasteriseMetafile(picture);
    const label = standalone ? base : `${base} - picture ${index + 1}`;
    if (png) outputs.push({ name: `${label}.png`, mime: 'image/png', bytes: png });
    else warnings.push(`Picture ${index + 1} (${picture.kind.toUpperCase()}) could not be converted to PNG in this browser.`);
  }
  return { outputs, warnings };
}
