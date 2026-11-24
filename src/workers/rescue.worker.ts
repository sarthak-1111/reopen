import { rescueFile } from '../core/rescue';
import type { RescueRequest, RescueResponse } from './protocol';

/** The parts of the dedicated-worker global scope this file uses. */
interface WorkerScope {
  onmessage: ((event: MessageEvent<RescueRequest>) => void) | null;
  postMessage(message: RescueResponse, transfer: Transferable[]): void;
}

/**
 * Converts one file at a time, entirely on this device. WMF/EMF pictures need the DOM, so they
 * are left for the main thread (the core reports them in `result.pictures`).
 */
const scope = self as unknown as WorkerScope;

scope.onmessage = async (event: MessageEvent<RescueRequest>) => {
  const { id, path, bytes } = event.data;
  let response: RescueResponse;
  try {
    const result = await rescueFile(path, new Uint8Array(bytes));
    response = { id, ok: true, result };
  } catch (error) {
    response = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const transfer: ArrayBuffer[] = [];
  if (response.ok) {
    const seen = new Set<ArrayBufferLike>();
    for (const output of response.result.outputs) {
      const buffer = output.bytes.buffer;
      // Only transfer buffers that belong to exactly one view, so nothing else is detached.
      if (buffer instanceof ArrayBuffer && !seen.has(buffer) && output.bytes.byteOffset === 0 && output.bytes.byteLength === buffer.byteLength) {
        seen.add(buffer);
        transfer.push(buffer);
      }
    }
  }
  scope.postMessage(response, transfer);
};
