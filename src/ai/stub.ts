import { proposeName } from '../core/naming';
import type { AiService, FileInsight, LedgerEntry, Reconstruction, ReconstructedBlock } from './contract';

/** Human-readable category for a detected format, without any AI. */
export function categoryForFormat(format: string): string {
  if (/^(xls|sylk|dif|lotus|quattro|works-sheet|dbf|spreadsheetml)/.test(format)) return 'Spreadsheet';
  if (/^(rtf|word|wordperfect|works-wps|write|ichitaro)/.test(format)) return 'Document';
  if (format === 'text' || format === 'ebcdic-text') return 'Text';
  if (format.endsWith('-image')) return 'Image';
  if (format === 'ole-unknown' || format === 'zip' || format === 'ooxml' || format === 'opendocument') return 'Container';
  return 'Unknown';
}

/** Splits raw recovered text into paragraphs exactly as found (nothing added, nothing reordered). */
export function rawBlocks(sourceText: string): ReconstructedBlock[] {
  return sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((text) => ({ kind: 'paragraph', text }));
}

/**
 * Behaves like "on-device AI not set up": every answer is deterministic and labelled NO_AI,
 * and nothing is ever sent anywhere, so the ledger stays empty.
 */
export function createStubAiService(): AiService {
  const entries: LedgerEntry[] = [];
  return {
    async nanoState() {
      return 'not-configured';
    },
    async warmUp() {
      throw new Error('On-device AI is not set up in this build.');
    },
    async triage(input): Promise<FileInsight> {
      return {
        category: categoryForFormat(input.detectedFormat),
        summary: null,
        proposedName: proposeName({ text: input.textSample, originalName: input.fileName }),
        encodingHint: input.encoding,
        badge: 'NO_AI',
      };
    },
    async reconstruct(input): Promise<Reconstruction> {
      return { blocks: rawBlocks(input.sourceText), badge: 'NO_AI', mode: 'raw-fallback', noInvention: { ok: true, inventedTokens: [] } };
    },
    ledger() {
      return entries;
    },
    onLedgerChange() {
      return () => undefined;
    },
  };
}
