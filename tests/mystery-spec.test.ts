import { describe, expect, it } from 'vitest';
import { manifest, sampleBytes } from './helpers';

/**
 * A reference reader written only from docs/specs/quillstone-notebook-qnb.md. It proves the
 * mystery samples follow their public specification, so a plugin drafted from that spec can be
 * checked against them (the conformance step before any plugin is used).
 */
function readQnb(bytes: Uint8Array): { title: string; date: string; records: { type: number; text: string }[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const unscramble = (part: Uint8Array) => new TextDecoder('windows-1252').decode(part.map((b) => b ^ 0x5a));
  expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('QNB1');
  expect(view.getUint16(4, true)).toBe(3);
  const count = view.getUint16(6, true);
  const date = `${view.getUint16(8, true)}-${String(bytes[10]).padStart(2, '0')}-${String(bytes[11]).padStart(2, '0')}`;
  const title = unscramble(bytes.subarray(13, 13 + bytes[12]!));
  const records = [];
  let offset = 32;
  for (let k = 0; k < count; k++) {
    const length = view.getUint16(offset + 1, true);
    records.push({ type: bytes[offset]!, text: unscramble(bytes.subarray(offset + 3, offset + 3 + length)) });
    offset += 3 + length;
  }
  expect(offset).toBe(bytes.length);
  return { title, date, records };
}

describe('mystery samples follow their public spec', () => {
  for (const sample of manifest().filter((s) => s.mystery && !s.copyOf)) {
    it(sample.path, () => {
      const page = readQnb(sampleBytes(sample.path));
      expect(page.title).toBe(sample.title);
      expect(page.records.map((r) => r.text)).toEqual(sample.includes);
      expect(page.records.every((r) => [1, 2, 3].includes(r.type))).toBe(true);
    });
  }
});
