/** Small, bounds-checked byte helpers. Every reader returns `undefined` instead of throwing. */

export function u8(bytes: Uint8Array, offset: number): number | undefined {
  return offset >= 0 && offset < bytes.length ? bytes[offset] : undefined;
}

export function u16le(bytes: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 2 > bytes.length) return undefined;
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

export function u32le(bytes: Uint8Array, offset: number): number | undefined {
  if (offset < 0 || offset + 4 > bytes.length) return undefined;
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

export function i32le(bytes: Uint8Array, offset: number): number | undefined {
  const value = u32le(bytes, offset);
  return value === undefined ? undefined : value | 0;
}

export function startsWith(bytes: Uint8Array, prefix: readonly number[], at = 0): boolean {
  if (at + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[at + i] !== prefix[i]) return false;
  return true;
}

/** Latin-1 view of the first `length` bytes, for signature checks only. */
export function asciiHead(bytes: Uint8Array, length: number, at = 0): string {
  let out = '';
  const end = Math.min(bytes.length, at + length);
  for (let i = at; i < end; i++) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}

export function toUint8Array(data: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return Uint8Array.from(data);
  return new Uint8Array(data);
}

export function hex(value: number, width = 2): string {
  return `0x${value.toString(16).toUpperCase().padStart(width, '0')}`;
}
