import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SAMPLES = join(ROOT, 'samples');

export interface SampleExpectation {
  path: string;
  bytes: number;
  format: string;
  encoding?: string;
  title?: string;
  includes?: string[];
  excludes?: string[];
  headings?: string[];
  listItems?: number;
  pictures?: number;
  mystery?: string;
  copyOf?: string;
}

export function manifest(): SampleExpectation[] {
  return JSON.parse(readFileSync(join(SAMPLES, 'manifest.json'), 'utf8')) as SampleExpectation[];
}

export function sampleBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(join(SAMPLES, path)));
}

/** Collapses whitespace so expectations are not sensitive to line wrapping. */
export const squash = (text: string): string => text.replace(/\s+/g, ' ');
