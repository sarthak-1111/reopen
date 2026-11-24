import { initFirebase } from '../firebase/init';
import { DEFAULT_CONFIG, loadRemoteConfig, type ReopenConfig } from '../firebase/remote-config';
import { createCloudGate, type CloudGate } from './cloud-gate';
import { createCloudGenerate } from './cloud-model';
import { createConsentStore, type ConsentStore } from './consent';
import type { AiService } from './contract';
import { createLedger, type Ledger } from './ledger';
import { createOnDeviceModel } from './models';
import { createAiService, type LanguageModelLike } from './service';
import { createStubAiService } from './stub';
import { createTaintRegistry, type TaintRegistry } from './taint';

export type { AiService } from './contract';

/** Everything the app needs from the AI layer, built once at start-up. */
export interface AiRuntime {
  service: AiService;
  /** Null when Firebase is not configured: the cloud lane cannot exist. */
  gate: CloudGate | null;
  consent: ConsentStore;
  taint: TaintRegistry;
  ledger: Ledger;
  config: ReopenConfig;
  aiConfigured: boolean;
  /** Why Firebase could not be set up, if it couldn't. */
  setupError: string | null;
}

let runtime: AiRuntime | undefined;
let stub: AiService | undefined;

const languageModel = (): LanguageModelLike | undefined => (globalThis as { LanguageModel?: LanguageModelLike }).LanguageModel;

/**
 * Composition root. This is the only module that imports the cloud model factory, and it
 * passes it straight into `createCloudGate`, so the gate is the only path to the cloud.
 */
export async function initAiRuntime(): Promise<AiRuntime> {
  if (runtime) return runtime;
  const ledger = createLedger();
  const taint = createTaintRegistry();
  const consent = createConsentStore();

  try {
    const handles = initFirebase();
    let config = await loadRemoteConfig(handles.app);
    const gate = createCloudGate({
      config: () => config,
      isOnline: () => navigator.onLine,
      consent,
      taint,
      ledger,
      cloudGenerate: (modelName, schema, maxOutputTokens) => createCloudGenerate(handles.ai, modelName, schema, maxOutputTokens),
    });
    const service = createAiService({
      configured: true,
      config: () => config,
      ledger,
      makeOnDeviceModel: (schema) => createOnDeviceModel(handles.ai, schema),
      languageModel,
    });
    runtime = { service, gate, consent, taint, ledger, config, aiConfigured: true, setupError: null };
    // Keep a fresher Remote Config if it arrives later (e.g. after coming back online).
    window.addEventListener('online', () => {
      void loadRemoteConfig(handles.app).then((fresh) => {
        config = fresh;
        if (runtime) runtime.config = fresh;
      });
    });
  } catch (error) {
    runtime = {
      service: createStubAiService(),
      gate: null,
      consent,
      taint,
      ledger,
      config: DEFAULT_CONFIG,
      aiConfigured: false,
      setupError: error instanceof Error ? error.message : String(error),
    };
  }
  return runtime;
}

/** The single place the UI obtains its AI service (the stub until `initAiRuntime` has run). */
export function getAiService(): AiService {
  if (runtime) return runtime.service;
  stub ??= createStubAiService();
  return stub;
}
