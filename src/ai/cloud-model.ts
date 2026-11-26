import { getGenerativeModel, InferenceMode, type AI } from 'firebase/ai';
import type { CloudModelOptions } from './cloud-gate';
import { badgeFromSource, type Generate } from './models';

/**
 * Cloud-only model factory. Imported ONLY by `src/ai/index.ts`, which hands it to
 * `createCloudGate` and nowhere else (enforced by an architecture test). So every cloud
 * request goes through the gate's Remote Config, offline, consent and taint checks and is
 * written to the Privacy Ledger before it is sent.
 *
 * JSON mode without `responseSchema`: the reply format is part of the prompt text (see
 * `buildCloudPayload`), and the answer is validated locally. Constrained decoding with the
 * reader-plugin schema failed against the real service (HTTP 400 "too many states", then a 503
 * timeout), 2026-11-26.
 */
export function createCloudGenerate(ai: AI, modelName: string, options: CloudModelOptions): Generate {
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: options.maxOutputTokens,
        ...(options.thinkingLevel ? { thinkingConfig: { thinkingLevel: options.thinkingLevel } } : {}),
      },
    },
  });
  return async (prompt) => {
    const result = await model.generateContent(prompt);
    return { text: result.response.text(), badge: badgeFromSource(result.response.inferenceSource) };
  };
}
