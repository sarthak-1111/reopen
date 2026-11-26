import type { FirebaseApp } from 'firebase/app';
import { fetchAndActivate, getRemoteConfig, getValue } from 'firebase/remote-config';

export type CloudThinkingLevel = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
const THINKING_LEVELS: readonly CloudThinkingLevel[] = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];

/** App settings controlled from Firebase Remote Config. */
export interface ReopenConfig {
  /** Opt-in format researcher may call the cloud (public documentation only). */
  cloudLaneEnabled: boolean;
  /** Files converted in parallel. */
  batchSize: number;
  /** Cloud model for the format researcher. */
  cloudModel: string;
  cloudMaxOutputTokens: number;
  /** Gemini thinking level for the cloud call; null leaves it to the model. */
  cloudThinkingLevel: CloudThinkingLevel | null;
  /** Max characters of recovered text per on-device call. */
  nanoChunkChars: number;
  /** Structured-output attempts before falling back. */
  aiMaxAttempts: number;
  /** Where the values came from. */
  source: 'remote' | 'cached-or-default';
}

/** In-app defaults. The cloud lane is OFF unless Remote Config turns it on (fail closed). */
export const DEFAULT_CONFIG: ReopenConfig = {
  cloudLaneEnabled: false,
  batchSize: 4,
  cloudModel: 'gemini-4-hydrogen',
  cloudMaxOutputTokens: 4096,
  cloudThinkingLevel: 'LOW',
  nanoChunkChars: 6000,
  aiMaxAttempts: 3,
  source: 'cached-or-default',
};

const clamp = (value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

/** Validates raw values so a bad Remote Config entry can never break the app. */
export function sanitiseConfig(raw: Partial<Record<keyof ReopenConfig, unknown>>, source: ReopenConfig['source']): ReopenConfig {
  const model = typeof raw.cloudModel === 'string' && /^[a-z0-9.\-]{3,64}$/.test(raw.cloudModel) ? raw.cloudModel : DEFAULT_CONFIG.cloudModel;
  const level = typeof raw.cloudThinkingLevel === 'string' ? raw.cloudThinkingLevel.trim().toUpperCase() : undefined;
  const thinking =
    level === '' || level === 'NONE' ? null : THINKING_LEVELS.find((candidate) => candidate === level) ?? DEFAULT_CONFIG.cloudThinkingLevel;
  return {
    cloudLaneEnabled: raw.cloudLaneEnabled === true,
    batchSize: clamp(Number(raw.batchSize), 1, 8, DEFAULT_CONFIG.batchSize),
    cloudModel: model,
    cloudMaxOutputTokens: clamp(Number(raw.cloudMaxOutputTokens), 256, 8192, DEFAULT_CONFIG.cloudMaxOutputTokens),
    cloudThinkingLevel: thinking,
    nanoChunkChars: clamp(Number(raw.nanoChunkChars), 500, 20000, DEFAULT_CONFIG.nanoChunkChars),
    aiMaxAttempts: clamp(Number(raw.aiMaxAttempts), 1, 5, DEFAULT_CONFIG.aiMaxAttempts),
    source,
  };
}

/**
 * Fetches and activates Remote Config, giving up after `timeoutMs`.
 * Offline (or on timeout) the last activated values or the in-app defaults are used.
 */
export async function loadRemoteConfig(app: FirebaseApp, timeoutMs = 4000): Promise<ReopenConfig> {
  const remoteConfig = getRemoteConfig(app);
  remoteConfig.settings.minimumFetchIntervalMillis = 60 * 60 * 1000;
  remoteConfig.settings.fetchTimeoutMillis = timeoutMs;
  remoteConfig.defaultConfig = {
    cloud_lane_enabled: DEFAULT_CONFIG.cloudLaneEnabled,
    batch_size: DEFAULT_CONFIG.batchSize,
    cloud_model: DEFAULT_CONFIG.cloudModel,
    cloud_max_output_tokens: DEFAULT_CONFIG.cloudMaxOutputTokens,
    cloud_thinking_level: DEFAULT_CONFIG.cloudThinkingLevel ?? '',
    nano_chunk_chars: DEFAULT_CONFIG.nanoChunkChars,
    ai_max_attempts: DEFAULT_CONFIG.aiMaxAttempts,
  };

  let source: ReopenConfig['source'] = 'cached-or-default';
  try {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs));
    await Promise.race([fetchAndActivate(remoteConfig), timeout]);
    source = 'remote';
  } catch {
    // Offline or slow: keep cached/default values.
  }

  return sanitiseConfig(
    {
      cloudLaneEnabled: getValue(remoteConfig, 'cloud_lane_enabled').asBoolean(),
      batchSize: getValue(remoteConfig, 'batch_size').asNumber(),
      cloudModel: getValue(remoteConfig, 'cloud_model').asString(),
      cloudMaxOutputTokens: getValue(remoteConfig, 'cloud_max_output_tokens').asNumber(),
      cloudThinkingLevel: getValue(remoteConfig, 'cloud_thinking_level').asString(),
      nanoChunkChars: getValue(remoteConfig, 'nano_chunk_chars').asNumber(),
      aiMaxAttempts: getValue(remoteConfig, 'ai_max_attempts').asNumber(),
    },
    source,
  );
}
