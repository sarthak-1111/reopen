import type { AiService } from './contract';
import { createStubAiService } from './stub';

export type { AiService } from './contract';

let service: AiService | undefined;

/** The single place the app obtains its AI service. */
export function getAiService(): AiService {
  service ??= createStubAiService();
  return service;
}
