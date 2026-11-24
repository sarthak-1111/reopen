import sampleZipUrl from '../../samples/old-folder.zip?url';
import type { AiService, FileInsight, Reconstruction } from '../ai/contract';
import { getAiService } from '../ai';
import type { OutputFile, RescueResult } from '../core/types';
import { sanitiseFileName } from '../core/naming';
import { zipFiles } from '../core/package';
import { blocksToMarkdown } from '../core/writers/markdown';
import { docxBytes } from '../core/writers/docx';
import { renderCard, renderFailedCard } from './cards';
import { byId, clear, downloadBytes, h, revokeAllObjectUrls } from './dom';
import { selectFiles } from './filter';
import {
  canPickFolder,
  expandSingleZip,
  filesFromDrop,
  filesFromInput,
  fromFile,
  InputError,
  pickFolder,
  sampleFolder,
  type PendingFile,
} from './input';
import { mountLedgerPanel } from './ledger-panel';
import { mountNanoChip } from './nano-chip';
import { createRescuePool, type RescuePool } from './pool';
import { rasteriseResultPictures } from './rasterise';
import { mountResearcherPlaceholder } from './researcher-panel';
import {
  buildExportFiles,
  chooseFinalName,
  emptyCounters,
  fileNameOf,
  reconstructionToBlocks,
  reconstructionUsable,
  renameOutputs,
  textSampleOf,
  type Counters,
  type RescuedItem,
} from './view-model';

export interface AppOptions {
  /** Files converted in parallel (Remote Config `batch_size`; default 4). */
  batchSize: number;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const RECONSTRUCTED_NOTE = 'Paragraphs and headings were reconstructed from the recovered text. Every word comes from the original file; nothing was added.';

type FileStatus = 'Waiting' | 'Reading' | 'Converting on this device' | 'Understanding' | 'Done' | 'Failed';

export function startApp(options: AppOptions): void {
  const ai: AiService = getAiService();
  const els = {
    pick: byId<HTMLButtonElement>('pick-folder'),
    folderInput: byId<HTMLInputElement>('folder-input'),
    folderInputLabel: byId('folder-input-label'),
    zipInput: byId<HTMLInputElement>('zip-input'),
    sample: byId<HTMLButtonElement>('try-sample'),
    dropzone: byId('dropzone'),
    inputError: byId('input-error'),
    results: byId('results'),
    library: byId('library'),
    status: byId('run-status'),
    progress: byId<HTMLProgressElement>('run-progress'),
    fileList: byId('file-list'),
    exportAll: byId<HTMLButtonElement>('export-all'),
    startOver: byId<HTMLButtonElement>('start-over'),
    countDevice: byId('count-device'),
    countCloud: byId('count-cloud'),
    countSkipped: byId('count-skipped'),
    nano: byId('nano-status'),
    ledger: byId('ledger-root'),
    researcher: byId('format-researcher-root'),
  };

  let counters: Counters = emptyCounters();
  let items: RescuedItem[] = [];
  let taken = new Set<string>();
  let pool: RescuePool | undefined;
  let runId = 0;
  let runLabel = '';
  let aiChain: Promise<unknown> = Promise.resolve();

  const renderCounters = (): void => {
    counters.cloudCalls = ai.ledger().length;
    els.countDevice.textContent = String(counters.processedOnDevice);
    els.countCloud.textContent = String(counters.cloudCalls);
    els.countSkipped.textContent = String(counters.skipped);
  };

  mountNanoChip(els.nano, ai);
  mountLedgerPanel(els.ledger, ai);
  ai.onLedgerChange(renderCounters);
  mountResearcherPlaceholder(els.researcher);
  renderCounters();

  // Chrome: the File System Access picker. Elsewhere: the classic folder <input> takes its place.
  if (!canPickFolder()) {
    els.pick.hidden = true;
    els.folderInputLabel.hidden = false;
    els.folderInputLabel.classList.add('btn-primary');
  }

  const showInputError = (message: string | undefined): void => {
    els.inputError.textContent = message ?? '';
    els.inputError.hidden = !message;
  };

  // ---- one file through the pipeline ----

  /** Runs AI steps one at a time (Gemini Nano handles one prompt at a time). */
  const queueAi = <T>(task: () => Promise<T>): Promise<T> => {
    const run = aiChain.then(task);
    aiChain = run.catch(() => undefined);
    return run;
  };

  const understand = async (result: RescueResult, path: string): Promise<{ insight?: FileInsight; reconstruction?: Reconstruction }> => {
    const sample = textSampleOf(result);
    let insight: FileInsight | undefined;
    let reconstruction: Reconstruction | undefined;
    if (sample.trim().length > 0) {
      try {
        insight = await queueAi(() => ai.triage({ fileName: fileNameOf(path), detectedFormat: result.detected.format, textSample: sample, encoding: result.encoding?.encoding ?? null }));
      } catch {
        insight = undefined;
      }
    }
    if (result.conversionLevel === 'text-recovery' && result.recoveredText) {
      try {
        const recovered = result.recoveredText;
        reconstruction = await queueAi(() => ai.reconstruct({ sourceText: recovered, runs: (result.textRuns ?? []).map((r) => r.text), language: null }));
      } catch {
        reconstruction = undefined;
      }
    }
    return { ...(insight ? { insight } : {}), ...(reconstruction ? { reconstruction } : {}) };
  };

  const reconstructedOutputs = async (reconstruction: Reconstruction | undefined, base: string): Promise<OutputFile[]> => {
    if (!reconstructionUsable(reconstruction) || !reconstruction) return [];
    const blocks = reconstructionToBlocks(reconstruction);
    const name = `${base} (reconstructed)`;
    return [
      { name: `${name}.md`, mime: 'text/markdown;charset=utf-8', bytes: new TextEncoder().encode(blocksToMarkdown(blocks, { note: RECONSTRUCTED_NOTE })) },
      { name: `${name}.docx`, mime: DOCX_MIME, bytes: await docxBytes(blocks, { note: RECONSTRUCTED_NOTE }) },
    ];
  };

  const processFile = async (file: PendingFile, myRun: number, setStatus: (s: FileStatus) => void): Promise<void> => {
    try {
      setStatus('Reading');
      const bytes = await file.read();
      if (myRun !== runId || !pool) return;
      setStatus('Converting on this device');
      const result = await pool.rescue(file.path, bytes);
      if (myRun !== runId) return;
      counters.processedOnDevice++;
      renderCounters();

      const pictures = result.pictures?.some((p) => p.kind === 'wmf' || p.kind === 'emf')
        ? await rasteriseResultPictures(result, result.proposedName)
        : { outputs: [], warnings: result.warnings };
      result.warnings = pictures.warnings;

      setStatus('Understanding');
      const { insight, reconstruction } = await understand(result, file.path);
      if (myRun !== runId) return;

      const { name, source } = chooseFinalName(result, insight, taken);
      result.outputs = renameOutputs(result.outputs, result.proposedName, name);
      const extraOutputs = [...renameOutputs(pictures.outputs, result.proposedName, name), ...(await reconstructedOutputs(reconstruction, name))];
      const item: RescuedItem = {
        id: items.length + 1,
        originalPath: file.path,
        result,
        finalName: name,
        nameSource: source,
        extraOutputs,
        ...(insight ? { insight } : {}),
        ...(reconstruction ? { reconstruction } : {}),
      };
      items.push(item);
      els.library.append(renderCard(item, items.length - 1));
      setStatus('Done');
    } catch (error) {
      if (myRun !== runId) return;
      counters.failed++;
      els.library.append(renderFailedCard(file.path, file.size, error instanceof Error ? error.message : String(error)));
      setStatus('Failed');
    }
  };

  // ---- a whole rescue run ----

  const announce = (text: string): void => {
    els.status.textContent = text;
  };

  const run = async (files: PendingFile[], label: string, preSkipped: string[] = []): Promise<void> => {
    showInputError(undefined);
    runId++;
    const myRun = runId;
    pool?.terminate();
    revokeAllObjectUrls();
    items = [];
    taken = new Set<string>();
    counters = emptyCounters();
    runLabel = label;
    clear(els.library);
    clear(els.fileList);
    els.exportAll.disabled = true;

    const { keep, skipped } = selectFiles(files);
    counters.queued = keep.length;
    counters.skipped = skipped.length + preSkipped.length;
    renderCounters();
    els.results.hidden = false;

    if (keep.length === 0) {
      announce(files.length === 0 ? 'That folder looks empty.' : 'Nothing to rescue: every file was a system, hidden or empty file.');
      els.progress.hidden = true;
      return;
    }

    els.progress.hidden = false;
    els.progress.max = keep.length;
    els.progress.value = 0;
    announce(`Rescuing ${keep.length} file${keep.length === 1 ? '' : 's'} from “${label}” on this device…`);
    els.results.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });

    const statusCells = new Map<PendingFile, HTMLElement>();
    for (const file of keep) {
      const cell = h('span', { class: 'file-status', text: 'Waiting' });
      statusCells.set(file, cell);
      els.fileList.append(h('li', {}, h('code', { text: file.path }), ' ', cell));
    }
    for (const s of skipped) els.fileList.append(h('li', { class: 'muted' }, h('code', { text: s.path }), ` skipped (${s.reason})`));
    for (const s of preSkipped) els.fileList.append(h('li', { class: 'muted' }, h('code', { text: s }), ' skipped'));

    pool = createRescuePool(options.batchSize);
    let done = 0;
    let next = 0;
    const limit = pool.size * 2;
    const worker = async (): Promise<void> => {
      while (next < keep.length && myRun === runId) {
        const file = keep[next++]!;
        const cell = statusCells.get(file)!;
        await processFile(file, myRun, (status) => {
          cell.textContent = status;
          cell.dataset.status = status;
        });
        if (myRun !== runId) return;
        done++;
        els.progress.value = done;
        if (done % 5 === 0 || done === keep.length) announce(`${done} of ${keep.length} files done on this device.`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, keep.length) }, worker));
    if (myRun !== runId) return;

    pool.terminate();
    pool = undefined;
    const rescued = items.filter((i) => i.result.outputs.length + i.extraOutputs.length > 0).length;
    announce(
      `Finished: ${rescued} of ${keep.length} file${keep.length === 1 ? '' : 's'} rescued on this device` +
        (counters.failed ? `, ${counters.failed} failed` : '') +
        (counters.skipped ? `, ${counters.skipped} skipped` : '') +
        `. Cloud calls: ${ai.ledger().length}.`,
    );
    els.exportAll.disabled = items.length === 0;
  };

  const exportAll = async (): Promise<void> => {
    if (items.length === 0) return;
    els.exportAll.disabled = true;
    try {
      const sorted = [...items].sort((a, b) => a.originalPath.localeCompare(b.originalPath, 'en', { numeric: true }));
      const createdAt = new Date().toISOString();
      const files = buildExportFiles(sorted, {
        title: `Reopen rescue of ${runLabel}`,
        createdAt,
        filesProcessedOnDevice: counters.processedOnDevice,
        cloudCalls: ai.ledger().length,
      });
      const zip = zipFiles(files);
      downloadBytes(zip, `${sanitiseFileName(`Reopen - ${runLabel} - ${createdAt.slice(0, 10)}`)}.zip`, 'application/zip');
    } finally {
      els.exportAll.disabled = false;
    }
  };

  // ---- inputs ----

  const guarded = (task: () => Promise<void>) => async (): Promise<void> => {
    try {
      await task();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return; // user closed the picker
      showInputError(error instanceof InputError ? error.message : `Something went wrong: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  els.pick.addEventListener(
    'click',
    guarded(async () => {
      const { folderName, files } = await pickFolder();
      const expanded = await expandSingleZip(files);
      await run(expanded.files, folderName, expanded.skipped);
    }),
  );

  els.folderInput.addEventListener(
    'change',
    guarded(async () => {
      const list = els.folderInput.files;
      if (!list || list.length === 0) return;
      const files = filesFromInput(list);
      const label = files[0]?.path.split('/')[0] ?? 'your folder';
      els.folderInput.value = '';
      await run(files, label);
    }),
  );

  els.zipInput.addEventListener(
    'change',
    guarded(async () => {
      const file = els.zipInput.files?.[0];
      els.zipInput.value = '';
      if (!file) return;
      const expanded = await expandSingleZip([fromFile(file.name, file)]);
      await run(expanded.files, file.name.replace(/\.zip$/i, ''), expanded.skipped);
    }),
  );

  els.sample.addEventListener(
    'click',
    guarded(async () => {
      const { files, skipped } = await sampleFolder(sampleZipUrl);
      await run(files, 'OLDPC (self-made sample folder)', skipped);
    }),
  );

  els.exportAll.addEventListener('click', () => void exportAll());
  els.startOver.addEventListener('click', () => {
    runId++;
    pool?.terminate();
    pool = undefined;
    revokeAllObjectUrls();
    items = [];
    counters = emptyCounters();
    clear(els.library);
    clear(els.fileList);
    els.results.hidden = true;
    renderCounters();
    byId('main').focus();
  });

  // Drag and drop: the drop zone accepts folders, files or a single .zip.
  let dragDepth = 0;
  const setDragging = (on: boolean): void => {
    els.dropzone.classList.toggle('dragging', on);
  };
  els.dropzone.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth++;
    setDragging(true);
  });
  els.dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  els.dropzone.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setDragging(false);
  });
  els.dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    setDragging(false);
    const data = event.dataTransfer;
    if (!data) return;
    void guarded(async () => {
      const dropped = await filesFromDrop(data);
      const expanded = await expandSingleZip(dropped);
      const first = dropped[0]?.path ?? 'dropped files';
      await run(expanded.files, expanded.fromZip ? first.replace(/\.zip$/i, '') : (first.split('/')[0] ?? first), expanded.skipped);
    })();
  });
  // Dropping outside the zone must not navigate away from the app.
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());
}
