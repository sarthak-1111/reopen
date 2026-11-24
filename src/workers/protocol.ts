import type { RescueResult } from '../core/types';

/** Main thread → rescue worker. `bytes` is transferred, not copied. */
export interface RescueRequest {
  id: number;
  path: string;
  bytes: ArrayBuffer;
}

/** Rescue worker → main thread. */
export type RescueResponse =
  | { id: number; ok: true; result: RescueResult }
  | { id: number; ok: false; error: string };
