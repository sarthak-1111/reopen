/**
 * Getting files from the user: File System Access folder picker, drag-and-drop (folders or
 * files), a classic folder <input>, zip upload, and the bundled sample folder. Everything is read
 * into memory locally; nothing is uploaded anywhere.
 */
import { unzipFolder } from '../core/package';

/** A file waiting to be rescued. `read` is lazy so large folders don't load all at once. */
export interface PendingFile {
  path: string;
  size: number;
  read: () => Promise<Uint8Array>;
}

export class InputError extends Error {
  override name = 'InputError';
}

export const fromFile = (path: string, file: File): PendingFile => ({
  path,
  size: file.size,
  read: async () => new Uint8Array(await file.arrayBuffer()),
});

// ---- File System Access API (Chrome) ----

interface DirectoryHandleLike {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FileHandleLike | DirectoryHandleLike>;
}
interface FileHandleLike {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}

type ShowDirectoryPicker = (options?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<DirectoryHandleLike>;

export function canPickFolder(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

async function walkHandle(dir: DirectoryHandleLike, prefix: string, out: PendingFile[]): Promise<void> {
  for await (const entry of dir.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      out.push(fromFile(path, file));
    } else {
      await walkHandle(entry, path, out);
    }
  }
}

/** Opens the folder picker (read-only) and lists every file inside, recursively. */
export async function pickFolder(): Promise<{ folderName: string; files: PendingFile[] }> {
  const picker = (window as unknown as { showDirectoryPicker?: ShowDirectoryPicker }).showDirectoryPicker;
  if (!picker) throw new InputError('This browser cannot open folders directly. Drop the folder here or upload a .zip instead.');
  const dir = await picker({ mode: 'read', id: 'reopen-folder' });
  const files: PendingFile[] = [];
  await walkHandle(dir, dir.name, files);
  return { folderName: dir.name, files };
}

// ---- <input type=file webkitdirectory> / multiple files ----

export function filesFromInput(list: FileList): PendingFile[] {
  return Array.from(list, (file) => fromFile((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, file));
}

// ---- Drag and drop ----

interface EntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
}
interface FileEntryLike extends EntryLike {
  file(success: (file: File) => void, failure: (error: unknown) => void): void;
}
interface DirectoryEntryLike extends EntryLike {
  createReader(): { readEntries(success: (entries: EntryLike[]) => void, failure: (error: unknown) => void): void };
}

const entryFile = (entry: FileEntryLike): Promise<File> => new Promise((resolve, reject) => entry.file(resolve, reject));

async function readAllEntries(dir: DirectoryEntryLike): Promise<EntryLike[]> {
  const reader = dir.createReader();
  const all: EntryLike[] = [];
  // readEntries returns results in batches; keep calling until it returns an empty batch.
  for (;;) {
    const batch = await new Promise<EntryLike[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

async function walkEntry(entry: EntryLike, out: PendingFile[]): Promise<void> {
  const path = entry.fullPath.replace(/^\/+/, '') || entry.name;
  if (entry.isFile) out.push(fromFile(path, await entryFile(entry as FileEntryLike)));
  else if (entry.isDirectory) for (const child of await readAllEntries(entry as DirectoryEntryLike)) await walkEntry(child, out);
}

/** Collects every file from a drop (folders are walked recursively). */
export async function filesFromDrop(data: DataTransfer): Promise<PendingFile[]> {
  const entries: EntryLike[] = [];
  const looseFiles: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue;
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => EntryLike | null }).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
    else {
      const file = item.getAsFile();
      if (file) looseFiles.push(file);
    }
  }
  const out: PendingFile[] = [];
  for (const entry of entries) await walkEntry(entry, out);
  for (const file of looseFiles) out.push(fromFile(file.name, file));
  return out;
}

// ---- Zip ----

export function isZipName(name: string): boolean {
  return name.toLowerCase().endsWith('.zip');
}

/** Expands a zip held in memory into pending files (limits and zip-slip checks live in the core). */
export function filesFromZip(bytes: Uint8Array): { files: PendingFile[]; skipped: string[] } {
  const { files, skipped } = unzipFolder(bytes);
  return {
    files: files.map((file) => ({ path: file.path, size: file.bytes.length, read: async () => file.bytes })),
    skipped,
  };
}

/**
 * If the user dropped or picked exactly one .zip, expand it; otherwise return the files as they are.
 */
export async function expandSingleZip(files: PendingFile[]): Promise<{ files: PendingFile[]; skipped: string[]; fromZip: boolean }> {
  const only = files.length === 1 ? files[0] : undefined;
  if (only && isZipName(only.path)) {
    const expanded = filesFromZip(await only.read());
    return { ...expanded, fromZip: true };
  }
  return { files, skipped: [], fromZip: false };
}

// ---- Bundled sample folder ----

/** The self-made sample folder ships as one zip asset so it can be cached for offline use. */
export async function sampleFolder(url: string): Promise<{ files: PendingFile[]; skipped: string[] }> {
  const response = await fetch(url);
  if (!response.ok) throw new InputError(`Could not load the sample folder (${response.status}).`);
  return filesFromZip(new Uint8Array(await response.arrayBuffer()));
}
