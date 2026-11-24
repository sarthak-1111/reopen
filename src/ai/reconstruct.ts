import { checkNoInvention } from '../core/no-invention';
import type { InferenceBadge, Reconstruction, ReconstructedBlock } from './contract';
import type { Generate } from './models';
import { rawBlocks } from './stub';
import { compileSchema, generateStructured } from './structured';

interface ReconstructionAnswer {
  blocks: ReconstructedBlock[];
}

export const reconstructionSchema = {
  type: 'object',
  properties: {
    blocks: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['heading', 'paragraph', 'list-item'] },
          text: { type: 'string' },
        },
        required: ['kind', 'text'],
      },
    },
  },
  required: ['blocks'],
} as const;

const validateReconstruction = compileSchema<ReconstructionAnswer>(reconstructionSchema);

export function reconstructionPrompt(chunk: string): string {
  return [
    'The text below was recovered from an old document. Line breaks may be broken and pieces may be out of order.',
    'Rebuild it as a list of blocks: headings, paragraphs and list items.',
    'Rules:',
    '- Use ONLY words that appear in the text. Never add, translate, summarise, correct or complete words.',
    '- You may join broken lines, reorder pieces, drop stray symbols and repeated fragments, and mark headings and list items.',
    '- Keep the original language.',
    '',
    'TEXT:',
    '"""',
    chunk,
    '"""',
  ].join('\n');
}

/** Splits text into chunks of at most `maxChars`, at line boundaries where possible. */
export function chunkText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split(/\r?\n/)) {
    let rest = line;
    while (rest.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      chunks.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    const candidate = current ? `${current}\n${rest}` : rest;
    if (candidate.length > maxChars) {
      chunks.push(current);
      current = rest;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks.filter((chunk) => chunk.trim().length > 0);
}

const joined = (blocks: readonly ReconstructedBlock[]): string => blocks.map((block) => block.text).join('\n');

function rawFallback(sourceText: string, inventedTokens: string[], badge: InferenceBadge): Reconstruction {
  return {
    blocks: rawBlocks(sourceText),
    badge,
    mode: 'raw-fallback',
    noInvention: { ok: inventedTokens.length === 0, inventedTokens },
  };
}

/**
 * On-device reconstruction under the no-invention rule. Every chunk's answer is checked with
 * `checkNoInvention` against that chunk's source text; an answer that adds any word is
 * rejected (and retried with the offending words named). If any chunk still fails, the whole
 * file falls back to the raw recovered text, clearly labelled.
 */
export async function runReconstruction(
  generate: Generate,
  sourceText: string,
  options: { chunkChars: number; maxAttempts: number },
): Promise<Reconstruction> {
  const chunks = chunkText(sourceText, options.chunkChars);
  if (chunks.length === 0) return rawFallback(sourceText, [], 'NO_AI');

  const blocks: ReconstructedBlock[] = [];
  const badges = new Set<InferenceBadge>();
  for (const chunk of chunks) {
    let lastInvented: string[] = [];
    const result = await generateStructured<ReconstructionAnswer>({
      generate,
      prompt: reconstructionPrompt(chunk),
      validate: validateReconstruction,
      maxAttempts: options.maxAttempts,
      check: (answer) => {
        const cleaned = answer.blocks.filter((block) => block.text.trim().length > 0);
        if (cleaned.length === 0) return 'blocks must contain text.';
        const verdict = checkNoInvention(chunk, joined(cleaned));
        lastInvented = verdict.inventedTokens;
        return verdict.ok ? null : `these words are not in the text: ${verdict.inventedTokens.slice(0, 20).join(', ')}.`;
      },
    });
    if (!result.ok) {
      return rawFallback(sourceText, lastInvented, result.modelError ? 'NO_AI' : result.badge);
    }
    badges.add(result.badge);
    blocks.push(...result.data.blocks.filter((block) => block.text.trim().length > 0).map((block) => ({ kind: block.kind, text: block.text.trim() })));
  }

  // Belt and braces: re-check the assembled output against the whole source.
  const verdict = checkNoInvention(sourceText, joined(blocks));
  if (!verdict.ok) return rawFallback(sourceText, verdict.inventedTokens, [...badges][0] ?? 'UNKNOWN');

  const badge: InferenceBadge = badges.size === 1 ? [...badges][0]! : 'UNKNOWN';
  return { blocks, badge, mode: 'ai-structured', noInvention: { ok: true, inventedTokens: [] } };
}
