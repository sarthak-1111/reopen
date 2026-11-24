import type { InferenceBadge } from '../../src/ai/contract';
import type { GenResult, Generate } from '../../src/ai/models';
import { DEFAULT_CONFIG, type ReopenConfig } from '../../src/firebase/remote-config';

/** A fake model that returns the given answers in order (objects are JSON-encoded). */
export function scriptedModel(answers: Array<unknown | Error>, badge: InferenceBadge = 'ON_DEVICE'): Generate & { prompts: string[] } {
  const prompts: string[] = [];
  let index = 0;
  const generate = (async (prompt: string): Promise<GenResult> => {
    prompts.push(prompt);
    const answer = answers[Math.min(index, answers.length - 1)];
    index += 1;
    if (answer instanceof Error) throw answer;
    return { text: typeof answer === 'string' ? answer : JSON.stringify(answer), badge };
  }) as Generate & { prompts: string[] };
  generate.prompts = prompts;
  return generate;
}

export const config = (overrides: Partial<ReopenConfig> = {}): ReopenConfig => ({ ...DEFAULT_CONFIG, ...overrides });

/** Extracts the TEXT section that the reconstruction prompt embeds. */
export function promptText(prompt: string): string {
  const match = /TEXT:\n"""\n([\s\S]*)\n"""/.exec(prompt);
  return match ? match[1]! : '';
}
