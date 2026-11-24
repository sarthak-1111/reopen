import Ajv, { type ValidateFunction } from 'ajv';
import type { InferenceBadge } from './contract';
import type { Generate } from './models';

const ajv = new Ajv({ allErrors: true, strict: false });

export function compileSchema<T>(schema: object): ValidateFunction<T> {
  return ajv.compile<T>(schema);
}

export type StructuredResult<T> =
  | { ok: true; data: T; badge: InferenceBadge; attempts: number }
  | { ok: false; reason: string; badge: InferenceBadge; attempts: number; modelError: boolean };

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Models sometimes wrap JSON in a Markdown fence; accept that, nothing else. */
export function extractJson(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return (fenced ? fenced[1]! : text).trim();
}

function retryPrompt(original: string, problem: string): string {
  return `${original}\n\nYour previous answer was rejected: ${problem}\nAnswer again with JSON that matches the schema exactly.`;
}

/**
 * Calls a model, parses its JSON and validates it against `validate` (plus an optional
 * semantic `check`). Invalid answers are retried with the validation error fed back, up to
 * `maxAttempts`. A thrown model error (e.g. Nano unavailable) is not retried.
 */
export async function generateStructured<T>(options: {
  generate: Generate;
  prompt: string;
  validate: ValidateFunction<T>;
  maxAttempts: number;
  check?: (data: T) => string | null;
}): Promise<StructuredResult<T>> {
  let prompt = options.prompt;
  let badge: InferenceBadge = 'UNKNOWN';
  let lastProblem = 'no answer';
  const attempts = Math.max(1, options.maxAttempts);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let text: string;
    try {
      const result = await options.generate(prompt);
      text = result.text;
      badge = result.badge;
    } catch (error) {
      return { ok: false, reason: describe(error), badge, attempts: attempt, modelError: true };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      lastProblem = 'the answer was not valid JSON.';
      prompt = retryPrompt(options.prompt, lastProblem);
      continue;
    }
    if (!options.validate(parsed)) {
      lastProblem = ajv.errorsText(options.validate.errors);
      prompt = retryPrompt(options.prompt, lastProblem);
      continue;
    }
    const semantic = options.check?.(parsed) ?? null;
    if (semantic) {
      lastProblem = semantic;
      prompt = retryPrompt(options.prompt, lastProblem);
      continue;
    }
    return { ok: true, data: parsed, badge, attempts: attempt };
  }
  return { ok: false, reason: lastProblem, badge, attempts, modelError: false };
}
