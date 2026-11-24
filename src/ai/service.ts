import type { ReopenConfig } from '../firebase/remote-config';
import type { AiService, NanoState } from './contract';
import type { Ledger } from './ledger';
import { NANO_LANGUAGES, type OnDeviceModel } from './models';
import { runReconstruction, reconstructionSchema } from './reconstruct';
import { createStubAiService } from './stub';
import { runTriage, triageSchema } from './triage';

/** Chrome's Prompt API entry point (only the part Reopen uses). */
export interface LanguageModelLike {
  availability(options?: unknown): Promise<string>;
}

export interface AiServiceDeps {
  /** False when Firebase is not configured in this build. */
  configured: boolean;
  config: () => ReopenConfig;
  ledger: Ledger;
  makeOnDeviceModel: (schema: object) => OnDeviceModel;
  languageModel: () => LanguageModelLike | undefined;
}

const AVAILABILITY_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: NANO_LANGUAGES }],
  expectedOutputs: [{ type: 'text', languages: NANO_LANGUAGES }],
};

const KNOWN_STATES: readonly NanoState[] = ['available', 'downloadable', 'downloading', 'unavailable'];

/**
 * The real AI service. File contents only ever go to ONLY_ON_DEVICE models. When Gemini Nano
 * is not ready, every answer is deterministic (badge NO_AI) — file contents are never sent to
 * the cloud as a fallback.
 */
export function createAiService(deps: AiServiceDeps): AiService {
  const fallback = createStubAiService();
  let triageModel: OnDeviceModel | undefined;
  let reconstructModel: OnDeviceModel | undefined;
  const initialised = new WeakSet<OnDeviceModel>();

  const ready = async (model: OnDeviceModel): Promise<OnDeviceModel> => {
    if (!initialised.has(model)) {
      await model.initialize();
      initialised.add(model);
    }
    return model;
  };
  const getTriageModel = (): OnDeviceModel => (triageModel ??= deps.makeOnDeviceModel(triageSchema));
  const getReconstructModel = (): OnDeviceModel => (reconstructModel ??= deps.makeOnDeviceModel(reconstructionSchema));

  const nanoState = async (): Promise<NanoState> => {
    if (!deps.configured) return 'not-configured';
    const languageModel = deps.languageModel();
    if (!languageModel) return 'no-api';
    try {
      const state = await languageModel.availability(AVAILABILITY_OPTIONS);
      return (KNOWN_STATES as readonly string[]).includes(state) ? (state as NanoState) : 'unavailable';
    } catch {
      return 'unavailable';
    }
  };

  return {
    nanoState,
    async warmUp(onProgress) {
      if (!deps.configured) throw new Error('On-device AI is not set up in this build.');
      // Must run from a user gesture: the first call may start Chrome's model download.
      const triage = getTriageModel();
      await triage.initialize(onProgress);
      initialised.add(triage);
      const reconstruct = getReconstructModel();
      await reconstruct.initialize();
      initialised.add(reconstruct);
    },
    async triage(input) {
      if ((await nanoState()) !== 'available') return fallback.triage(input);
      try {
        const model = await ready(getTriageModel());
        return (await runTriage(model.generate, input, deps.config().aiMaxAttempts)) ?? (await fallback.triage(input));
      } catch {
        return fallback.triage(input);
      }
    },
    async reconstruct(input) {
      if ((await nanoState()) !== 'available') return fallback.reconstruct(input);
      try {
        const model = await ready(getReconstructModel());
        const config = deps.config();
        return await runReconstruction(model.generate, input.sourceText, { chunkChars: config.nanoChunkChars, maxAttempts: config.aiMaxAttempts });
      } catch {
        return fallback.reconstruct(input);
      }
    },
    ledger: () => deps.ledger.entries(),
    onLedgerChange: (listener) => deps.ledger.onChange(listener),
  };
}
