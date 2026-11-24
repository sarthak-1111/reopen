import { SDK_VERSION } from 'firebase/app';
import {
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  Schema,
  type AI,
  type GenerativeModel,
} from 'firebase/ai';
import { initFirebase } from '../src/firebase/init';

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
interface LanguageModelLike {
  availability(options?: unknown): Promise<Availability>;
}

interface SmokeRecord {
  test: 'on-device' | 'cloud';
  at: string;
  online: boolean;
  ok: boolean;
  inferenceSource?: string;
  schemaValid?: boolean;
  output?: unknown;
  latencyMs?: number;
  requests?: string[];
  error?: string;
}

const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
};

// Self-made sample text (fictional, no real people or data).
const SAMPLE_TEXT =
  'MEMO, 2 March 1994. Stock count for the riverside office is complete. ' +
  'Totals are in the attached sheet. Please file under first quarter. Accounts team.';

const PROMPT =
  'Read this recovered document. Return JSON with "summary" (one short sentence) and ' +
  '"documentType" (one or two words, e.g. memo, letter, invoice).\n\n' +
  SAMPLE_TEXT;

const resultSchema = Schema.object({
  properties: {
    summary: Schema.string(),
    documentType: Schema.string(),
  },
});

function isValidResult(value: unknown): value is { summary: string; documentType: string } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.summary === 'string' && typeof record.documentType === 'string';
}

// --- Network capture: every fetch and resource load, query strings stripped. ---
const requestLog: string[] = [];
const stripQuery = (url: string): string => url.split('?')[0] ?? url;
const originalFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  requestLog.push(`fetch ${stripQuery(url)}`);
  return originalFetch(input, init);
};
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) requestLog.push(`resource ${stripQuery(entry.name)}`);
}).observe({ type: 'resource', buffered: false });

// --- Environment panel ---
const languageModel = (globalThis as { LanguageModel?: LanguageModelLike }).LanguageModel;

async function refreshNano(): Promise<void> {
  const target = el('nano');
  if (!languageModel) {
    target.textContent = 'LanguageModel API not present in this browser';
    return;
  }
  try {
    target.textContent = await languageModel.availability();
  } catch (error) {
    target.textContent = `error: ${describe(error)}`;
  }
}

function refreshOnline(): void {
  el('online').textContent = String(navigator.onLine);
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

// --- Models ---
let ai: AI | undefined;
let deviceModel: GenerativeModel | undefined;
let deviceReady = false;

function getAi(): AI {
  if (!ai) {
    const handles = initFirebase();
    el('appcheck-mode').textContent = handles.appCheckMode;
    ai = handles.ai;
  }
  return ai;
}

function getDeviceModel(): GenerativeModel {
  deviceModel ??= getGenerativeModel(getAi(), {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: { promptOptions: { responseConstraint: resultSchema } },
  });
  return deviceModel;
}

function getCloudModel(modelName: string): GenerativeModel {
  return getGenerativeModel(getAi(), {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: modelName,
      generationConfig: { responseMimeType: 'application/json', responseSchema: resultSchema },
    },
  });
}

async function warmUp(): Promise<void> {
  const status = el('warmup-status');
  const progress = el<HTMLProgressElement>('warmup-progress');
  status.textContent = 'Initialising…';
  try {
    await getDeviceModel().initializeDeviceModel((value) => {
      progress.value = value;
      status.textContent = `Downloading ${(value * 100).toFixed(0)}%`;
    });
    deviceReady = true;
    progress.value = 1;
    status.textContent = 'Ready';
  } catch (error) {
    status.textContent = `Failed: ${describe(error)}`;
  }
  await refreshNano();
}

// --- Runs ---
function badgeFor(source: string | undefined): string {
  if (source === InferenceSource.ON_DEVICE) return '<span class="badge device">ON DEVICE</span>';
  if (source === InferenceSource.IN_CLOUD) return '<span class="badge cloud">CLOUD</span>';
  return '<span class="badge unknown">UNKNOWN</span>';
}

function render(target: HTMLElement, record: SmokeRecord): void {
  const status = record.ok ? '<span class="ok">passed</span>' : '<span class="bad">failed</span>';
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(
    { output: record.output, error: record.error, requests: record.requests },
    null,
    2,
  );
  target.innerHTML = `${badgeFor(record.inferenceSource)} ${status} · ${record.latencyMs ?? '?'} ms · inferenceSource = ${record.inferenceSource ?? 'missing'}`;
  target.append(pre);
}

async function run(test: SmokeRecord['test']): Promise<void> {
  const target = el(test === 'on-device' ? 'device-result' : 'cloud-result');
  target.textContent = 'Running…';
  const record: SmokeRecord = { test, at: new Date().toISOString(), online: navigator.onLine, ok: false };
  const start = requestLog.length;
  const t0 = performance.now();
  try {
    let model: GenerativeModel;
    if (test === 'on-device') {
      model = getDeviceModel();
      if (!deviceReady) {
        await model.initializeDeviceModel();
        deviceReady = true;
      }
    } else {
      model = getCloudModel(el<HTMLInputElement>('cloud-model').value.trim());
    }
    const result = await model.generateContent(PROMPT);
    record.inferenceSource = result.response.inferenceSource ?? undefined;
    const text = result.response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Keep the raw text; schemaValid will be false.
    }
    record.output = parsed;
    record.schemaValid = isValidResult(parsed);
    record.ok = record.schemaValid;
  } catch (error) {
    record.error = describe(error);
  }
  record.latencyMs = Math.round(performance.now() - t0);
  await new Promise((resolve) => setTimeout(resolve, 500)); // let resource timings arrive
  record.requests = requestLog.slice(start);
  render(target, record);
  el('smoke-results').textContent += `${JSON.stringify(record)}\n`;
  console.info('[reopen-smoke]', JSON.stringify(record));
}

// --- Wire up ---
el('sdk-version').textContent = SDK_VERSION;
refreshOnline();
window.addEventListener('online', refreshOnline);
window.addEventListener('offline', refreshOnline);
void refreshNano();
try {
  getAi();
} catch (error) {
  el('appcheck-mode').textContent = `not initialised: ${describe(error)}`;
}
el('refresh-nano').addEventListener('click', () => void refreshNano());
el('warmup').addEventListener('click', () => void warmUp());
el('run-device').addEventListener('click', () => void run('on-device'));
el('run-cloud').addEventListener('click', () => void run('cloud'));
