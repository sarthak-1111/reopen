import type { RescueResult } from '../core/types';
import type { RescueRequest, RescueResponse } from '../workers/protocol';

interface Task {
  id: number;
  path: string;
  bytes: Uint8Array;
  resolve: (result: RescueResult) => void;
  reject: (error: Error) => void;
}

export interface RescuePool {
  rescue(path: string, bytes: Uint8Array): Promise<RescueResult>;
  terminate(): void;
  readonly size: number;
}

/** Clamps the Remote-Config-style batch size to something sensible for this device. */
export function poolSize(batchSize: number, hardwareConcurrency: number | undefined): number {
  const cores = hardwareConcurrency && hardwareConcurrency > 0 ? hardwareConcurrency : 2;
  const requested = Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : 4;
  return Math.max(1, Math.min(requested, cores, 8));
}

/** A small pool of module workers that run `rescueFile` off the main thread. */
export function createRescuePool(batchSize: number): RescuePool {
  const size = poolSize(batchSize, navigator.hardwareConcurrency);
  const queue: Task[] = [];
  const idle: Worker[] = [];
  const running = new Map<Worker, Task>();
  let nextId = 1;

  const spawn = (): Worker => {
    const worker = new Worker(new URL('../workers/rescue.worker.ts', import.meta.url), { type: 'module', name: 'reopen-rescue' });
    worker.onmessage = (event: MessageEvent<RescueResponse>) => {
      const task = running.get(worker);
      running.delete(worker);
      if (task && task.id === event.data.id) {
        if (event.data.ok) task.resolve(event.data.result);
        else task.reject(new Error(event.data.error));
      }
      idle.push(worker);
      pump();
    };
    worker.onerror = (event) => {
      const task = running.get(worker);
      running.delete(worker);
      task?.reject(new Error(event.message || 'The rescue worker stopped unexpectedly.'));
      worker.terminate();
      idle.push(spawn());
      pump();
    };
    return worker;
  };

  const pump = (): void => {
    while (idle.length > 0 && queue.length > 0) {
      const worker = idle.pop()!;
      const task = queue.shift()!;
      running.set(worker, task);
      // Copy into a fresh buffer we own, then transfer it to the worker.
      const buffer = task.bytes.slice().buffer as ArrayBuffer;
      const request: RescueRequest = { id: task.id, path: task.path, bytes: buffer };
      worker.postMessage(request, [buffer]);
    }
  };

  for (let i = 0; i < size; i++) idle.push(spawn());

  return {
    size,
    rescue(path, bytes) {
      return new Promise<RescueResult>((resolve, reject) => {
        queue.push({ id: nextId++, path, bytes, resolve, reject });
        pump();
      });
    },
    terminate() {
      for (const worker of [...idle, ...running.keys()]) worker.terminate();
      for (const task of [...queue, ...running.values()]) task.reject(new Error('Cancelled'));
      queue.length = 0;
      idle.length = 0;
      running.clear();
    },
  };
}
