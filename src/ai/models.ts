import { getGenerativeModel, InferenceMode, InferenceSource, type AI } from 'firebase/ai';
import type { InferenceBadge } from './contract';

export interface GenResult {
  text: string;
  badge: InferenceBadge;
}
export type Generate = (prompt: string) => Promise<GenResult>;

/** The badge always comes from the SDK's own report (`response.inferenceSource`). */
export function badgeFromSource(source: string | undefined | null): InferenceBadge {
  if (source === InferenceSource.ON_DEVICE) return 'ON_DEVICE';
  if (source === InferenceSource.IN_CLOUD) return 'CLOUD';
  return 'UNKNOWN';
}

export interface OnDeviceModel {
  generate: Generate;
  initialize(onProgress?: (fraction: number) => void): Promise<void>;
}

/**
 * An on-device-only model (Gemini Nano through Firebase AI Logic). ONLY_ON_DEVICE never
 * falls back to the cloud: if Nano is unavailable the call throws, and callers use
 * deterministic output instead. File contents are only ever sent to models made here.
 */
/** Reopen handles English and Japanese text (the SDK defaults to English-only text input). */
export const NANO_LANGUAGES = ['en', 'ja'];

export function createOnDeviceModel(ai: AI, schema: object): OnDeviceModel {
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text', languages: NANO_LANGUAGES }],
        expectedOutputs: [{ type: 'text', languages: NANO_LANGUAGES }],
      },
      promptOptions: { responseConstraint: schema },
    },
  });
  return {
    initialize: (onProgress) => model.initializeDeviceModel(onProgress),
    async generate(prompt) {
      const result = await model.generateContent(prompt);
      return { text: result.response.text(), badge: badgeFromSource(result.response.inferenceSource) };
    },
  };
}
