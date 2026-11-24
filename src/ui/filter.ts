/** Rules for which files from a dropped folder are worth rescuing. Pure, so it is unit-tested. */

export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_FILES = 2000;

const SKIP_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', 'ehthumbs.db', '.localized', 'icon\r']);
const SKIP_DIRS = new Set(['__macosx', '.git', '.svn', 'node_modules', '$recycle.bin', 'system volume information', '.trashes', '.spotlight-v100', '.fseventsd']);

export type SkipReason = 'system file' | 'hidden file' | 'temporary file' | 'empty file' | 'too large';

/** Returns why a file should be skipped, or undefined to keep it. */
export function skipReason(path: string, size: number): SkipReason | undefined {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  const name = (parts[parts.length - 1] ?? '').toLowerCase();
  if (parts.slice(0, -1).some((dir) => SKIP_DIRS.has(dir.toLowerCase()))) return 'system file';
  if (SKIP_NAMES.has(name)) return 'system file';
  if (name.startsWith('._')) return 'system file'; // macOS resource-fork copies
  if (name.startsWith('~$') || name.endsWith('.tmp') || name.endsWith('~')) return 'temporary file';
  if (name.startsWith('.')) return 'hidden file';
  if (size === 0) return 'empty file';
  if (size > MAX_FILE_BYTES) return 'too large';
  return undefined;
}

export interface Candidate {
  path: string;
  size: number;
}

export interface Selection<T extends Candidate> {
  keep: T[];
  skipped: { path: string; reason: SkipReason | 'over the file limit' }[];
}

/** Applies `skipReason` and the overall file limit, keeping a stable, readable order. */
export function selectFiles<T extends Candidate>(candidates: readonly T[], maxFiles = MAX_FILES): Selection<T> {
  const sorted = [...candidates].sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }));
  const keep: T[] = [];
  const skipped: Selection<T>['skipped'] = [];
  for (const candidate of sorted) {
    const reason = skipReason(candidate.path, candidate.size);
    if (reason) skipped.push({ path: candidate.path, reason });
    else if (keep.length >= maxFiles) skipped.push({ path: candidate.path, reason: 'over the file limit' });
    else keep.push(candidate);
  }
  return { keep, skipped };
}
