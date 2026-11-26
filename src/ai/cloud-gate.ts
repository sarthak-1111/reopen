import type { CloudThinkingLevel, ReopenConfig } from '../firebase/remote-config';
import type { ConsentStore } from './consent';
import type { Ledger } from './ledger';
import type { GenResult, Generate } from './models';
import type { TaintRegistry } from './taint';

/**
 * THE ONLY WAY REOPEN TALKS TO A CLOUD MODEL.
 *
 * A cloud request carries public documentation that the user pasted or uploaded, plus fixed
 * instructions from the app. It never carries a rescued file: there is no parameter for one.
 * Before anything is sent the gate checks, in order:
 *   1. Remote Config `cloud_lane_enabled` is true;
 *   2. the browser is online;
 *   3. the user consented to this exact payload (single-use token, SHA-256 match);
 *   4. the payload contains no file bytes or file text (taint registry);
 * then writes the exact payload to the Privacy Ledger, and only then calls the model.
 */

export interface CloudRequest {
  feature: 'format-research';
  /** Fixed instructions written by the app (not user data). */
  instructions: string;
  /** Name of the public document, as given by the user. */
  docName: string;
  /** Public documentation text pasted or uploaded by the user. */
  docText: string;
  /**
   * Reply format (fixed, from the app source). Sent as TEXT inside the prompt, with JSON mode.
   * Constrained decoding was tried first and failed in Chrome on 2026-11-26: HTTP 400 "too many
   * states for serving", then a 503 timeout with a lighter schema. The answer is validated locally.
   */
  schema: object;
}

/** Cloud model settings from Remote Config. */
export interface CloudModelOptions {
  maxOutputTokens: number;
  thinkingLevel: CloudThinkingLevel | null;
}

export type CloudBlockCode = 'lane-disabled' | 'offline' | 'no-consent' | 'tainted' | 'empty';

export class CloudBlockedError extends Error {
  override name = 'CloudBlockedError';
  constructor(
    readonly code: CloudBlockCode,
    message: string,
  ) {
    super(message);
  }
}

export interface CloudGateDeps {
  config: () => ReopenConfig;
  isOnline: () => boolean;
  consent: ConsentStore;
  taint: TaintRegistry;
  ledger: Ledger;
  /** Factory for the cloud model; production passes `createCloudGenerate` bound to the AI instance. */
  cloudGenerate: (modelName: string, options: CloudModelOptions) => Generate;
}

/** Exactly the text that is sent as the prompt. Shown to the user before consent. */
export function buildCloudPayload(request: CloudRequest): string {
  return [
    request.instructions.trim(),
    '',
    'Reply format (JSON Schema):',
    JSON.stringify(request.schema),
    '',
    `--- PUBLIC DOCUMENTATION: ${request.docName.trim() || 'untitled'} ---`,
    request.docText.trim(),
    '--- END OF DOCUMENTATION ---',
  ].join('\n');
}

/** What the Privacy Ledger records: the prompt verbatim (it already contains the reply format). */
export function ledgerText(_request: CloudRequest, payload: string): string {
  return payload;
}

export interface CloudGate {
  payloadFor(request: CloudRequest): string;
  send(request: CloudRequest, consentToken: string): Promise<GenResult & { ledgerId: string }>;
}

export function createCloudGate(deps: CloudGateDeps): CloudGate {
  return {
    payloadFor: buildCloudPayload,
    async send(request, consentToken) {
      const payload = buildCloudPayload(request);
      if (request.docText.trim().length === 0) {
        throw new CloudBlockedError('empty', 'Paste or upload some public documentation first.');
      }
      const config = deps.config();
      if (!config.cloudLaneEnabled) {
        throw new CloudBlockedError('lane-disabled', 'The cloud lane is switched off (Remote Config).');
      }
      if (!deps.isOnline()) {
        throw new CloudBlockedError('offline', 'You are offline. The format researcher needs the network.');
      }
      if (!(await deps.consent.consume(consentToken, payload))) {
        throw new CloudBlockedError('no-consent', 'Nothing was sent: consent was not given for this exact text.');
      }
      const taint = deps.taint.check(payload);
      if (taint.tainted) {
        throw new CloudBlockedError('tainted', `Nothing was sent. ${taint.reason ?? ''} Reopen only sends public documentation.`);
      }

      const ledgerId = deps.ledger.record({ feature: request.feature, model: config.cloudModel, sentText: ledgerText(request, payload) });
      try {
        const generate = deps.cloudGenerate(config.cloudModel, { maxOutputTokens: config.cloudMaxOutputTokens, thinkingLevel: config.cloudThinkingLevel });
        const result = await generate(payload);
        deps.ledger.settle(ledgerId, 'ok', result.badge);
        return { ...result, ledgerId };
      } catch (error) {
        deps.ledger.settle(ledgerId, 'error', 'UNKNOWN');
        throw error;
      }
    },
  };
}
