import { decodeText, detectEncoding, normaliseNewlines } from '../encoding';
import type { Block, EncodingDetection } from '../types';

export interface TextResult {
  text: string;
  blocks: Block[];
  encoding: EncodingDetection;
}

/** Legacy-encoded plain text → Unicode. Paragraphs are separated by blank lines. */
export function readText(bytes: Uint8Array, forcedEncoding?: string): TextResult {
  const encoding = forcedEncoding
    ? { encoding: forcedEncoding, confidence: 1, candidates: [], method: ['encoding given by caller'] }
    : detectEncoding(bytes);
  const text = normaliseNewlines(decodeText(bytes, encoding.encoding)).replace(/\u001a$/, '');
  const blocks: Block[] = text
    .split(/\n\s*\n/)
    .map((chunk) => chunk.replace(/[ \t]+$/gm, '').trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => ({ type: 'paragraph', text: chunk }));
  return { text, blocks, encoding };
}
