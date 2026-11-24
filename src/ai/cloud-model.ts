import { getGenerativeModel, InferenceMode, type AI, type SchemaRequest } from 'firebase/ai';
import { badgeFromSource, type Generate } from './models';

/**
 * Cloud-only model factory. Imported ONLY by `src/ai/index.ts`, which hands it to
 * `createCloudGate` and nowhere else (enforced by an architecture test). So every cloud
 * request goes through the gate's Remote Config, offline, consent and taint checks and is
 * written to the Privacy Ledger before it is sent.
 */
export function createCloudGenerate(ai: AI, modelName: string, schema: object, maxOutputTokens: number): Generate {
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: schema as SchemaRequest,
        maxOutputTokens,
      },
    },
  });
  return async (prompt) => {
    const result = await model.generateContent(prompt);
    return { text: result.response.text(), badge: badgeFromSource(result.response.inferenceSource) };
  };
}
