/**
 * The only interface between the UI and the AI layer. The UI never imports Firebase or the
 * Prompt API directly; it talks to an `AiService` obtained from `getAiService()`.
 */

export type InferenceBadge = 'ON_DEVICE' | 'CLOUD' | 'UNKNOWN' | 'NO_AI';

export type NanoState = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no-api' | 'not-configured';

export interface FileInsight {
  category: string;
  summary: [string, string] | null;
  proposedName: string | null;
  encodingHint: string | null;
  badge: InferenceBadge;
}

export interface ReconstructedBlock {
  kind: 'heading' | 'paragraph' | 'list-item';
  text: string;
}

export interface Reconstruction {
  blocks: ReconstructedBlock[];
  badge: InferenceBadge;
  mode: 'ai-structured' | 'raw-fallback';
  noInvention: { ok: boolean; inventedTokens: string[] };
}

export interface LedgerEntry {
  id: string;
  at: string;
  feature: string;
  model: string;
  sentText: string;
  bytes: number;
  /** 'sending' while in flight. Blocked calls are never recorded: the gate refuses them before this point. */
  outcome: 'sending' | 'ok' | 'error';
  badge: InferenceBadge;
}

export interface AiService {
  nanoState(): Promise<NanoState>;
  warmUp(onProgress: (fraction: number) => void): Promise<void>;
  triage(input: { fileName: string; detectedFormat: string; textSample: string; encoding: string | null }): Promise<FileInsight>;
  reconstruct(input: { sourceText: string; runs: string[]; language: string | null }): Promise<Reconstruction>;
  ledger(): readonly LedgerEntry[];
  onLedgerChange(listener: () => void): () => void;
}
