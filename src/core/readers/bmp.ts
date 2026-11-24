import { i32le, u16le, u32le } from '../bytes';
import type { RgbaImage } from '../writers/png';

/**
 * Windows bitmap (BMP / DIB) decoder for uncompressed images: 1, 4, 8, 24 and 32 bits per
 * pixel (BI_RGB, and BI_BITFIELDS with the usual 32-bit masks). Accepts a full .bmp file
 * ("BM" header) or a bare DIB as embedded in RTF (\dibitmap). RLE-compressed bitmaps are not
 * supported and throw, so the caller can fall back to the browser.
 */

export class BmpError extends Error {
  override name = 'BmpError';
}

const MAX_PIXELS = 40_000_000;

export function decodeBmp(input: Uint8Array): RgbaImage {
  const hasFileHeader = input[0] === 0x42 && input[1] === 0x4d;
  const dib = hasFileHeader ? 14 : 0;
  const headerSize = u32le(input, dib);
  if (headerSize === undefined) throw new BmpError('Bitmap header is truncated.');

  let width: number;
  let height: number;
  let bitCount: number;
  let compression = 0;
  let colorsUsed = 0;
  let paletteEntrySize = 4;
  if (headerSize === 12) {
    width = u16le(input, dib + 4) ?? 0;
    height = u16le(input, dib + 6) ?? 0;
    bitCount = u16le(input, dib + 10) ?? 0;
    paletteEntrySize = 3;
  } else if (headerSize >= 40) {
    width = i32le(input, dib + 4) ?? 0;
    height = i32le(input, dib + 8) ?? 0;
    bitCount = u16le(input, dib + 14) ?? 0;
    compression = u32le(input, dib + 16) ?? 0;
    colorsUsed = u32le(input, dib + 32) ?? 0;
  } else throw new BmpError(`Unsupported bitmap header size ${headerSize}.`);

  const topDown = height < 0;
  height = Math.abs(height);
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) throw new BmpError(`Unsupported bitmap size ${width}×${height}.`);
  if (compression !== 0 && !(compression === 3 && bitCount === 32)) throw new BmpError(`Compressed bitmaps (type ${compression}) are not supported.`);
  if (![1, 4, 8, 24, 32].includes(bitCount)) throw new BmpError(`Unsupported bit depth ${bitCount}.`);

  const paletteCount = bitCount <= 8 ? colorsUsed || 1 << bitCount : 0;
  const masksSize = compression === 3 && headerSize === 40 ? 12 : 0;
  const paletteStart = dib + headerSize + masksSize;
  const palette: [number, number, number][] = [];
  for (let k = 0; k < paletteCount; k++) {
    const p = paletteStart + k * paletteEntrySize;
    palette.push([input[p + 2] ?? 0, input[p + 1] ?? 0, input[p] ?? 0]);
  }
  const pixelStart = hasFileHeader ? (u32le(input, 10) ?? 0) : paletteStart + paletteCount * paletteEntrySize;
  const stride = Math.ceil((width * bitCount) / 32) * 4;
  if (pixelStart + stride * height > input.length) throw new BmpError('Bitmap pixel data is truncated.');

  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const src = pixelStart + (topDown ? row : height - 1 - row) * stride;
    for (let x = 0; x < width; x++) {
      const o = (row * width + x) * 4;
      let r: number;
      let g: number;
      let b: number;
      if (bitCount === 24 || bitCount === 32) {
        const p = src + x * (bitCount / 8);
        [b, g, r] = [input[p]!, input[p + 1]!, input[p + 2]!];
      } else {
        const bitOffset = x * bitCount;
        const byte = input[src + (bitOffset >> 3)]!;
        const index = (byte >> (8 - bitCount - (bitOffset & 7))) & ((1 << bitCount) - 1);
        [r, g, b] = palette[index] ?? [0, 0, 0];
      }
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255; // the alpha byte of 32-bit BMPs is unreliable in old files
    }
  }
  return { width, height, rgba };
}
