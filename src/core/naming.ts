/**
 * Deterministic file naming (the no-AI fallback). A name is built from the document's title
 * or first meaningful line, plus a date when one is found, then made safe for Windows and macOS.
 */

const RESERVED_WINDOWS = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\..*)?$/i;
const ILLEGAL_CHARS = /[<>:"/\\|?*\u0000-\u001F\u007F]/g;
export const MAX_NAME_CHARS = 80;
const MAX_NAME_BYTES = 200;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11,
  november: 11, dec: 12, december: 12,
};

const pad = (n: number): string => String(n).padStart(2, '0');

function validDate(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Finds the first unambiguous date and returns it as YYYY-MM-DD. */
export function findDate(text: string): string | undefined {
  const sample = text.slice(0, 4000);
  const patterns: [RegExp, (m: RegExpMatchArray) => [number, number, number]][] = [
    [/\b(19\d\d|20\d\d)[-/.](\d{1,2})[-/.](\d{1,2})\b/, (m) => [Number(m[1]), Number(m[2]), Number(m[3])]],
    [/(19\d\d|20\d\d)年\s*(\d{1,2})月\s*(\d{1,2})日/, (m) => [Number(m[1]), Number(m[2]), Number(m[3])]],
    [
      /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(19\d\d|20\d\d)\b/,
      (m) => [Number(m[3]), MONTHS[m[2]!.toLowerCase()] ?? 0, Number(m[1])],
    ],
    [
      /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(19\d\d|20\d\d)\b/,
      (m) => [Number(m[3]), MONTHS[m[1]!.toLowerCase()] ?? 0, Number(m[2])],
    ],
  ];
  for (const [pattern, toParts] of patterns) {
    const match = pattern.exec(sample);
    if (!match) continue;
    const [y, m, d] = toParts(match);
    if (validDate(y, m, d)) return `${y}-${pad(m)}-${pad(d)}`;
  }
  return undefined;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Makes any string safe as a file name on Windows and macOS. Never returns an empty string. */
export function sanitiseFileName(raw: string): string {
  let name = raw.normalize('NFC').replace(ILLEGAL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  name = name.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  const chars = Array.from(name);
  if (chars.length > MAX_NAME_CHARS) name = chars.slice(0, MAX_NAME_CHARS).join('').trimEnd();
  while (utf8Length(name) > MAX_NAME_BYTES) name = Array.from(name).slice(0, -1).join('');
  name = name.replace(/[.\s]+$/, '');
  if (name.length === 0) name = 'untitled';
  if (RESERVED_WINDOWS.test(name)) name = `_${name}`;
  return name;
}

function firstMeaningfulLine(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const letters = (trimmed.match(/[\p{L}\p{N}]/gu) ?? []).length;
    if (letters >= 3) return trimmed;
  }
  return undefined;
}

function shorten(line: string, maxWords = 8): string {
  const cleaned = line.replace(/[#*_>`~=|]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/[぀-ヿ一-鿿]/.test(cleaned)) return Array.from(cleaned).slice(0, 24).join('');
  return cleaned.split(' ').slice(0, maxWords).join(' ');
}

export interface NameInput {
  title?: string;
  text?: string;
  originalName: string;
}

/** Proposes a base name (without extension). */
export function proposeName(input: NameInput): string {
  const titleSource = input.title?.trim() || firstMeaningfulLine(input.text ?? '');
  const date = findDate(`${input.title ?? ''}\n${input.text ?? ''}`);
  const original = (input.originalName.split(/[\\/]/).pop() ?? input.originalName).replace(/\.[^.]*$/, '');
  let base = titleSource ? shorten(titleSource) : original;
  if (date && !base.includes(date)) base = `${date} ${base}`;
  return sanitiseFileName(base);
}

/** Returns `name` or `name (2)`, `name (3)`… so that `name + ext` is unique (case-insensitive). */
export function uniqueName(base: string, extension: string, taken: Set<string>): string {
  const ext = extension.startsWith('.') || extension === '' ? extension : `.${extension}`;
  let candidate = base;
  for (let n = 2; taken.has(`${candidate}${ext}`.toLowerCase()); n++) candidate = `${base} (${n})`;
  taken.add(`${candidate}${ext}`.toLowerCase());
  return candidate;
}
