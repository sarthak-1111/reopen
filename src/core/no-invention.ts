/**
 * The no-invention rule: AI reconstruction may only reorder, clean and structure the text
 * that was recovered from a file. It must never add words.
 *
 * Definition used here (stricter than "every output word exists in the source"):
 * - Both texts are normalised with Unicode NFKC and compared with full case folding
 *   (so "großen" and "GROSSEN" match).
 * - Tokens are runs of letters/digits (with combining marks). Each Han ideograph, hiragana
 *   and katakana character is its own token, because Japanese has no spaces.
 * - Punctuation and whitespace are not tokens, so they may be added, removed or changed.
 * - MULTISET semantics: an output token may not appear more times than it does in the source.
 *   ("exists" alone would let the model repeat a source word to build new sentences.)
 * - One allowance: a word split by a line-break hyphen in the source ("recov-\nered") may be
 *   rejoined ("recovered"), since that is cleaning, not invention.
 */

const CJK = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}`;
/** One CJK character, or a run of other letters/digits/marks. */
const TOKEN = new RegExp(String.raw`[${CJK}]|(?:(?![${CJK}])[\p{L}\p{N}\p{M}])+`, 'gu');

/** NFKC plus full case folding (upper-then-lower maps ß→ss, ﬁ→fi, final σ/ς alike). */
export function normalise(text: string): string {
  return text.normalize('NFKC').toUpperCase().toLowerCase();
}

export function tokenize(text: string): string[] {
  return Array.from(normalise(text).matchAll(TOKEN), (match) => match[0]);
}

function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

/** Tokens formed by rejoining words broken with a hyphen at a line end ("recov-\nered"). */
function hyphenJoins(source: string): string[] {
  const joins: string[] = [];
  for (const match of normalise(source).matchAll(/([\p{L}\p{M}]+)-[ \t]*\r?\n[ \t]*([\p{L}\p{M}]+)/gu)) {
    joins.push(`${match[1]}${match[2]}`);
  }
  return joins;
}

export interface NoInventionResult {
  ok: boolean;
  /** Output tokens that are not covered by the source (each excess occurrence listed once). */
  inventedTokens: string[];
}

export function checkNoInvention(source: string, output: string): NoInventionResult {
  const available = countTokens(tokenize(source));
  for (const joined of hyphenJoins(source)) available.set(joined, (available.get(joined) ?? 0) + 1);
  const invented: string[] = [];
  for (const token of tokenize(output)) {
    const left = available.get(token) ?? 0;
    if (left > 0) available.set(token, left - 1);
    else invented.push(token);
  }
  return { ok: invented.length === 0, inventedTokens: invented };
}

export type ReconstructionMode = 'ai-reconstructed' | 'raw-fallback';

export interface EnforcedText {
  text: string;
  mode: ReconstructionMode;
  inventedTokens: string[];
}

/** Returns the AI output only if it passes the rule; otherwise the raw source, clearly labelled. */
export function enforceNoInvention(source: string, aiOutput: string): EnforcedText {
  const check = checkNoInvention(source, aiOutput);
  return check.ok
    ? { text: aiOutput, mode: 'ai-reconstructed', inventedTokens: [] }
    : { text: source, mode: 'raw-fallback', inventedTokens: check.inventedTokens };
}
