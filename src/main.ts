import './ui/styles.css';
import { initAiRuntime } from './ai';
import { startApp } from './ui/app';
import { byId } from './ui/dom';
import { registerServiceWorker, watchConnectivity } from './ui/sw-register';

watchConnectivity(byId('net-status'));
registerServiceWorker(byId('offline-status'));

// Firebase (App Check, AI Logic, Remote Config) is set up before the app starts. If it can't
// be (no config in this build), the app still converts files deterministically.
const runtime = await initAiRuntime();
if (runtime.setupError) console.info('[reopen] AI not configured:', runtime.setupError);

startApp({
  batchSize: runtime.config.batchSize,
  onFileLoaded: (bytes, text) => runtime.taint.registerFile(bytes, text),
  ...(runtime.gate
    ? {
        researcher: {
          gate: runtime.gate,
          consent: runtime.consent,
          cloudLaneEnabled: () => runtime.config.cloudLaneEnabled,
          aiConfigured: runtime.aiConfigured,
        },
      }
    : {}),
});
