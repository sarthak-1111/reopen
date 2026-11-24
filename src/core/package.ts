import { unzipSync, zipSync, type Zippable } from 'fflate';

export interface PackagedFile {
  path: string;
  bytes: Uint8Array;
}

/** Fixed timestamp so the same rescue always produces the same zip bytes. */
const FIXED_MTIME = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

/** Normalises a relative path and rejects absolute paths or ".." (zip-slip). */
export function safeRelativePath(path: string): string | undefined {
  const parts = path.replace(/\\/g, '/').split('/').filter((p) => p.length > 0 && p !== '.');
  if (parts.length === 0 || parts.some((p) => p === '..') || /^[a-zA-Z]:$/.test(parts[0] ?? '')) return undefined;
  if (path.startsWith('/')) return undefined;
  return parts.join('/');
}

export function zipFiles(files: PackagedFile[]): Uint8Array {
  const tree: Zippable = {};
  for (const file of files) {
    const path = safeRelativePath(file.path);
    if (!path) throw new Error(`Unsafe path in output: ${file.path}`);
    tree[path] = [file.bytes, { mtime: FIXED_MTIME }];
  }
  return zipSync(tree, { level: 6 });
}

export interface UnzipLimits {
  maxEntries: number;
  maxTotalBytes: number;
}

const DEFAULT_LIMITS: UnzipLimits = { maxEntries: 5000, maxTotalBytes: 1024 * 1024 * 1024 };

/** Unzips an uploaded folder in memory, skipping directories and unsafe paths, with size limits. */
export function unzipFolder(bytes: Uint8Array, limits: UnzipLimits = DEFAULT_LIMITS): { files: PackagedFile[]; skipped: string[] } {
  const skipped: string[] = [];
  let entries = 0;
  let total = 0;
  const raw = unzipSync(bytes, {
    filter(file) {
      if (file.name.endsWith('/')) return false;
      if (!safeRelativePath(file.name)) {
        skipped.push(`${file.name} (unsafe path)`);
        return false;
      }
      if (entries >= limits.maxEntries) {
        skipped.push(`${file.name} (too many files)`);
        return false;
      }
      if (total + file.originalSize > limits.maxTotalBytes) {
        skipped.push(`${file.name} (size limit)`);
        return false;
      }
      entries++;
      total += file.originalSize;
      return true;
    },
  });
  const files = Object.entries(raw).map(([path, data]) => ({ path: safeRelativePath(path)!, bytes: data }));
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped };
}
