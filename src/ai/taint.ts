/**
 * Defence-in-depth check that a cloud payload contains no file bytes and no file text.
 *
 * The primary guarantee is structural: the only cloud call (`sendToCloud`) accepts public
 * documentation text typed or uploaded by the user, never a rescued file. This registry
 * additionally fingerprints every file the user drops in, and the gate refuses any payload
 * that contains a long enough copy of one of them.
 *
 * Fingerprints are 32-bit FNV-1a hashes of fixed-size windows sampled at a fixed step, so a
 * copied run is always caught once it is at least WINDOW + STEP - 1 long:
 *   - bytes: 32-byte windows every 16 bytes → any run of ≥ 47 file bytes is caught, whether it
 *     appears raw (Latin-1 / UTF-8), as hex or as base64 in the payload;
 *   - text: 48-character windows every 8 characters → any copied run of ≥ 55 characters of
 *     extracted file text is caught (after whitespace/case normalisation).
 * Short shared strings (magic numbers, the small hex example in a public spec) are allowed.
 * Hash collisions can only cause a false block, never a leak.
 */

export const BYTE_WINDOW = 32;
export const BYTE_STEP = 16;
export const TEXT_WINDOW = 48;
export const TEXT_STEP = 8;
/** Guaranteed detection lengths. */
export const MIN_CAUGHT_BYTES = BYTE_WINDOW + BYTE_STEP - 1;
export const MIN_CAUGHT_CHARS = TEXT_WINDOW + TEXT_STEP - 1;

function fnv1a(data: ArrayLike<number>, start: number, length: number): number {
  let hash = 0x811c9dc5;
  for (let i = start; i < start + length; i++) {
    hash ^= data[i]! & 0xffff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Windows that are a single repeated value (zero padding etc.) carry no content. */
function isUniform(data: ArrayLike<number>, start: number, length: number): boolean {
  const first = data[start];
  for (let i = start + 1; i < start + length; i++) if (data[i] !== first) return false;
  return true;
}

export function normaliseForTaint(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
}

const codesOf = (text: string): number[] => Array.from(text, (ch) => ch.codePointAt(0) ?? 0);

export interface TaintVerdict {
  tainted: boolean;
  reason: string | null;
}

export interface TaintRegistry {
  registerFile(bytes: Uint8Array, text: string | null): void;
  check(payload: string): TaintVerdict;
  size(): number;
}

/** Decodes every hex run (pairs, optional separators) of at least `minBytes` bytes. */
function hexRuns(payload: string, minBytes: number): Uint8Array[] {
  const runs: Uint8Array[] = [];
  const pattern = /(?:[0-9a-fA-F]{2}[\s,:\-]?){2,}/g;
  for (const match of payload.matchAll(pattern)) {
    const digits = match[0].replace(/[^0-9a-fA-F]/g, '');
    if (digits.length / 2 < minBytes) continue;
    const bytes = new Uint8Array(Math.floor(digits.length / 2));
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16);
    runs.push(bytes);
  }
  return runs;
}

/** Decodes every base64-looking run long enough to hide `minBytes` bytes, at all 4 alignments. */
function base64Runs(payload: string, minBytes: number): Uint8Array[] {
  const runs: Uint8Array[] = [];
  const minChars = Math.ceil((minBytes * 4) / 3);
  for (const match of payload.matchAll(/[A-Za-z0-9+/_\-]{8,}={0,2}/g)) {
    const raw = match[0].replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
    if (raw.length < minChars) continue;
    for (let shift = 0; shift < 4; shift++) {
      const slice = raw.slice(shift);
      const usable = slice.slice(0, slice.length - (slice.length % 4));
      try {
        const binary = atob(usable);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        runs.push(bytes);
      } catch {
        // not base64 at this alignment
      }
    }
  }
  return runs;
}

export function createTaintRegistry(): TaintRegistry {
  const byteHashes = new Set<number>();
  const textHashes = new Set<number>();
  let files = 0;

  const hitsBytes = (data: ArrayLike<number>): boolean => {
    for (let i = 0; i + BYTE_WINDOW <= data.length; i++) {
      if (isUniform(data, i, BYTE_WINDOW)) continue;
      if (byteHashes.has(fnv1a(data, i, BYTE_WINDOW))) return true;
    }
    return false;
  };

  const hitsText = (codes: number[]): boolean => {
    for (let i = 0; i + TEXT_WINDOW <= codes.length; i++) {
      if (isUniform(codes, i, TEXT_WINDOW)) continue;
      if (textHashes.has(fnv1a(codes, i, TEXT_WINDOW))) return true;
    }
    return false;
  };

  return {
    registerFile(bytes, text) {
      files += 1;
      for (let i = 0; i + BYTE_WINDOW <= bytes.length; i += BYTE_STEP) {
        if (!isUniform(bytes, i, BYTE_WINDOW)) byteHashes.add(fnv1a(bytes, i, BYTE_WINDOW));
      }
      if (text) {
        const codes = codesOf(normaliseForTaint(text));
        for (let i = 0; i + TEXT_WINDOW <= codes.length; i += TEXT_STEP) {
          if (!isUniform(codes, i, TEXT_WINDOW)) textHashes.add(fnv1a(codes, i, TEXT_WINDOW));
        }
      }
    },
    check(payload) {
      if (files === 0) return { tainted: false, reason: null };
      if (hitsText(codesOf(normaliseForTaint(payload)))) {
        return { tainted: true, reason: 'The text contains a passage copied from one of your files.' };
      }
      const latin1 = Array.from(payload, (ch) => (ch.codePointAt(0) ?? 0) & 0xff);
      if (hitsBytes(latin1) || hitsBytes(new TextEncoder().encode(payload))) {
        return { tainted: true, reason: 'The text contains raw bytes copied from one of your files.' };
      }
      for (const run of [...hexRuns(payload, MIN_CAUGHT_BYTES), ...base64Runs(payload, BYTE_WINDOW)]) {
        if (hitsBytes(run)) return { tainted: true, reason: 'The text contains encoded bytes copied from one of your files.' };
      }
      return { tainted: false, reason: null };
    },
    size: () => files,
  };
}
