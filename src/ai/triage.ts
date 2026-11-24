import type { FileInsight } from './contract';
import type { Generate } from './models';
import { compileSchema, generateStructured } from './structured';

export const TRIAGE_CATEGORIES = [
  'letter',
  'memo',
  'report',
  'minutes',
  'invoice or receipt',
  'table or list',
  'notes',
  'recipe',
  'form',
  'manual or instructions',
  'other',
] as const;

export interface TriageAnswer {
  category: (typeof TRIAGE_CATEGORIES)[number];
  summaryLine1: string;
  summaryLine2: string;
  proposedName: string;
  language: string;
  readsAsNaturalText: boolean;
}

/** Used as the on-device responseConstraint and for local validation. */
export const triageSchema = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: [...TRIAGE_CATEGORIES], description: 'What kind of document this is.' },
    summaryLine1: { type: 'string', description: 'First line of a two-line factual summary (max 90 characters).' },
    summaryLine2: { type: 'string', description: 'Second line of the summary (max 90 characters).' },
    proposedName: {
      type: 'string',
      description: 'Short descriptive file name without extension, 2 to 8 words. Start with YYYY-MM-DD only if the text states a date.',
    },
    language: { type: 'string', description: 'ISO 639-1 code of the main language, for example en or ja.' },
    readsAsNaturalText: { type: 'boolean', description: 'false if the text looks garbled or decoded with the wrong character set.' },
  },
  required: ['category', 'summaryLine1', 'summaryLine2', 'proposedName', 'language', 'readsAsNaturalText'],
} as const;

const validateTriage = compileSchema<TriageAnswer>(triageSchema);

export const TRIAGE_SAMPLE_CHARS = 3000;

export function triagePrompt(input: { fileName: string; detectedFormat: string; textSample: string; encoding: string | null }): string {
  const sample = input.textSample.slice(0, TRIAGE_SAMPLE_CHARS);
  return [
    'You help someone rescue files from an old computer. Below is text recovered from one file.',
    `Original file name: ${input.fileName}`,
    `Detected format: ${input.detectedFormat}`,
    `Character encoding used to decode it: ${input.encoding ?? 'unknown'}`,
    '',
    'Return JSON with: the document category; a two-line factual summary written in the same language as the text,',
    'using only what the text says; a short descriptive file name; the main language code; and whether the text',
    'reads as natural language (false if it looks garbled or wrongly decoded).',
    '',
    'TEXT:',
    '"""',
    sample,
    '"""',
  ].join('\n');
}

export function checkTriage(answer: TriageAnswer): string | null {
  const lines = [answer.summaryLine1.trim(), answer.summaryLine2.trim()];
  if (lines.some((line) => line.length === 0)) return 'both summary lines must be non-empty.';
  if (lines.some((line) => line.length > 160)) return 'each summary line must be short (about 90 characters, never more than 160).';
  const name = answer.proposedName.trim();
  if (name.length === 0 || name.length > 80) return 'proposedName must be 1 to 80 characters.';
  if (!/[\p{L}\p{N}]/u.test(name)) return 'proposedName must contain letters or digits.';
  return null;
}

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Runs on-device triage. Returns null if Nano failed or never produced a valid answer. */
export async function runTriage(
  generate: Generate,
  input: { fileName: string; detectedFormat: string; textSample: string; encoding: string | null },
  maxAttempts: number,
): Promise<FileInsight | null> {
  const result = await generateStructured<TriageAnswer>({
    generate,
    prompt: triagePrompt(input),
    validate: validateTriage,
    maxAttempts,
    check: checkTriage,
  });
  if (!result.ok) return null;
  const answer = result.data;
  const encoding = input.encoding ?? 'unknown encoding';
  const encodingHint = answer.readsAsNaturalText
    ? `${encoding}: reads as natural ${answer.language} text (on-device check)`
    : `${encoding}: text may be wrongly decoded (on-device check)`;
  return {
    category: capitalise(answer.category),
    summary: [answer.summaryLine1.trim(), answer.summaryLine2.trim()],
    proposedName: answer.proposedName.trim(),
    encodingHint,
    badge: result.badge,
  };
}
