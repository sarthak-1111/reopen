import { plausibility } from '../core/encoding';
import { magicMatches, readWithPlugin, type PluginReadResult } from './interpreter';
import type { ReaderPlugin } from './plugin-schema';

/**
 * Local conformance tests: a drafted reader is used only if it passes ALL of these on every
 * sample file the user chose. Runs entirely on this device; the files never leave it.
 */

export const MIN_PLAUSIBILITY = 0.6;
/** Share of letters among non-space characters. XOR-ed or mis-decoded text turns into punctuation and digits. */
export const MIN_LETTER_SHARE = 0.5;
/** Share of control characters allowed (besides tab, line feed, carriage return). */
export const MAX_CONTROL_SHARE = 0.01;

/** Letter and control-character shares of decoded text (Unicode letters, so Japanese counts). */
export function textShape(text: string): { letterShare: number; controlShare: number } {
  let letters = 0;
  let visible = 0;
  let controls = 0;
  let total = 0;
  for (const ch of text) {
    total++;
    const c = ch.codePointAt(0)!;
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || (c >= 0x7f && c <= 0x9f)) controls++;
    if (/\s/u.test(ch)) continue;
    visible++;
    if (/\p{L}/u.test(ch)) letters++;
  }
  return { letterShare: visible ? letters / visible : 0, controlShare: total ? controls / total : 0 };
}

export interface ConformanceCheck {
  id: 'magic' | 'parses' | 'bounds' | 'consumed' | 'plausible' | 'deterministic' | 'has-text' | 'samples' | 'known-text';
  file: string;
  passed: boolean;
  detail: string;
}

export interface ConformanceReport {
  passed: boolean;
  checks: ConformanceCheck[];
  /** Successful reads, by file name (only meaningful when `passed`). */
  reads: Record<string, PluginReadResult>;
}

export interface SampleFile {
  name: string;
  bytes: Uint8Array;
}

const textOf = (read: PluginReadResult): string => [read.title ?? '', ...read.blocks.map((b) => b.text)].join('\n');

export interface ConformanceOptions {
  /**
   * A word or phrase the user knows is in at least one of the files. Strongly recommended:
   * the plausibility check cannot catch every subtle mistake (e.g. an XOR key that is off by
   * one bit still decodes to letters), but a known phrase can.
   */
  knownText?: string;
}

export function runConformance(plugin: ReaderPlugin, samples: readonly SampleFile[], options: ConformanceOptions = {}): ConformanceReport {
  const checks: ConformanceCheck[] = [];
  const reads: Record<string, PluginReadResult> = {};
  if (samples.length === 0) {
    checks.push({ id: 'samples', file: '—', passed: false, detail: 'Choose at least one sample file to test the reader on.' });
    return { passed: false, checks, reads };
  }

  for (const sample of samples) {
    const add = (id: ConformanceCheck['id'], passed: boolean, detail: string): void => {
      checks.push({ id, file: sample.name, passed, detail });
    };

    add('magic', magicMatches(plugin, sample.bytes), magicMatches(plugin, sample.bytes) ? 'Signature bytes match.' : 'Signature bytes do not match this file.');

    const read = readWithPlugin(plugin, sample.bytes);
    reads[sample.name] = read;
    add('parses', read.ok, read.ok ? `Read ${read.blocks.length} block(s) without errors.` : read.errors.join('; '));
    add('bounds', !read.outOfBounds, read.outOfBounds ? 'An offset or length points outside the file.' : 'Every offset and length stays inside the file.');

    const body = plugin.body;
    const until = body.kind === 'records' ? (body.until ?? (body.countFrom ? 'count' : 'end-of-file')) : null;
    if (until === 'end-of-file') {
      const whole = read.ok && read.bytesConsumed === sample.bytes.length;
      const countOk = read.declaredCount === undefined || read.declaredCount === read.recordCount;
      add(
        'consumed',
        whole && countOk,
        !whole
          ? `Read ${read.bytesConsumed} of ${sample.bytes.length} bytes.`
          : countOk
            ? `All ${sample.bytes.length} bytes accounted for${read.declaredCount !== undefined ? `; ${read.recordCount} records as the header says` : ''}.`
            : `The header says ${read.declaredCount} records but ${read.recordCount} were read.`,
      );
    } else if (until === 'count') {
      const countOk = read.ok && read.declaredCount === read.recordCount;
      const whole = read.bytesConsumed === sample.bytes.length;
      add(
        'consumed',
        countOk && whole,
        !countOk ? `Expected ${read.declaredCount ?? '?'} records, read ${read.recordCount}.` : whole ? `${read.recordCount} records, every byte accounted for.` : `${sample.bytes.length - read.bytesConsumed} bytes left unread after the last record.`,
      );
    } else {
      add('consumed', read.ok, read.ok ? 'Text block found inside the file.' : 'Text block could not be read.');
    }

    const text = textOf(read);
    const score = plausibility(text);
    const replacement = text.includes(String.fromCharCode(0xfffd));
    const shape = textShape(text);
    const plausible = read.ok && score >= MIN_PLAUSIBILITY && !replacement && shape.letterShare >= MIN_LETTER_SHARE && shape.controlShare <= MAX_CONTROL_SHARE;
    add(
      'plausible',
      plausible,
      replacement
        ? 'Decoded text contains replacement characters (wrong encoding or transform).'
        : `Plausibility ${score.toFixed(2)} (needs ≥ ${MIN_PLAUSIBILITY}); letters ${(shape.letterShare * 100).toFixed(0)}% of visible characters (needs ≥ ${MIN_LETTER_SHARE * 100}%); control characters ${(shape.controlShare * 100).toFixed(1)}% (max ${MAX_CONTROL_SHARE * 100}%).`,
    );

    const again = readWithPlugin(plugin, sample.bytes);
    const same = JSON.stringify(again) === JSON.stringify(read);
    add('deterministic', same, same ? 'Two reads give identical results.' : 'Two reads gave different results.');

    const hasText = read.blocks.some((b) => b.text.trim().length > 0);
    add('has-text', hasText, hasText ? 'Found readable text.' : 'No text found.');
  }

  const known = options.knownText?.trim();
  if (known) {
    const needle = known.toLowerCase().replace(/\s+/g, ' ');
    const found = Object.entries(reads).find(([, read]) => textOf(read).toLowerCase().replace(/\s+/g, ' ').includes(needle));
    checks.push({
      id: 'known-text',
      file: found ? found[0] : '(all files)',
      passed: !!found,
      detail: found ? `Found “${known}”.` : `“${known}” was not found in any file read with this reader.`,
    });
  }

  return { passed: checks.every((c) => c.passed), checks, reads };
}
