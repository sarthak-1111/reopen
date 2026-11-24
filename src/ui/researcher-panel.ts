import type { ConsentStore } from '../ai/consent';
import type { InferenceBadge } from '../ai/contract';
import type { RescueResult } from '../core/types';
import type { ConformanceReport, SampleFile } from '../research/conformance';
import type { ReaderPlugin } from '../research/plugin-schema';
import type { DraftResult, Researcher } from '../research/researcher';
import type { CloudRequest } from '../ai/cloud-gate';
import { badgeChip } from './cards';
import { clear, h } from './dom';

/**
 * The opt-in format researcher. The only thing it can send is public documentation the user
 * pasted or uploaded, and only through the cloud gate after explicit, per-call consent.
 * Sample files are tested HERE, on this device; their bytes are never handed to the gate.
 */

export function mountResearcherPlaceholder(root: HTMLElement): void {
  clear(root);
  root.dataset.placeholder = 'true';
  root.append(
    h(
      'p',
      { class: 'muted' },
      'When a file’s format is unknown, you can paste or upload its ',
      h('strong', { text: 'public documentation' }),
      '. Cloud Gemini drafts a reader from that documentation only; the reader is used after it passes tests on your files, here on this device. ',
      h('em', { text: 'Format researcher needs Firebase AI Logic; not configured in this build.' }),
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Controller: all decisions, no DOM (unit-tested).

export interface ResearcherControllerDeps {
  researcher: Researcher;
  consent: ConsentStore;
  cloudLaneEnabled: () => boolean;
  aiConfigured: boolean;
  isOnline: () => boolean;
}

export type LaneStatus = { usable: true; message: string } | { usable: false; message: string };

export function laneStatus(deps: Pick<ResearcherControllerDeps, 'aiConfigured' | 'cloudLaneEnabled' | 'isOnline'>): LaneStatus {
  if (!deps.aiConfigured) return { usable: false, message: 'Firebase AI Logic is not configured in this build, so the format researcher is off.' };
  if (!deps.cloudLaneEnabled()) return { usable: false, message: 'The cloud lane is switched off right now (Remote Config). Nothing can be sent.' };
  if (!deps.isOnline()) return { usable: false, message: 'You are offline. The format researcher needs the network; everything else keeps working.' };
  return { usable: true, message: 'Ready. Nothing is sent until you review the exact text and confirm.' };
}

export type ConfirmOutcome = DraftResult | { ok: false; code: 'not-confirmed' | 'nothing-prepared'; message: string; problems: string[] };

export interface ResearcherController {
  status(): LaneStatus;
  /** Builds the exact payload for review. Sends nothing. */
  prepare(docName: string, docText: string): { payload: string; bytes: number };
  /** Sends only if the user ticked "public documentation" for the prepared payload. */
  confirm(isPublicDocumentation: boolean): Promise<ConfirmOutcome>;
  /** Discards the prepared payload. Sends nothing. */
  cancel(): void;
}

export function createResearcherController(deps: ResearcherControllerDeps): ResearcherController {
  let pending: { request: CloudRequest; payload: string } | null = null;
  return {
    status: () => laneStatus(deps),
    prepare(docName, docText) {
      pending = deps.researcher.prepare(docName, docText);
      return { payload: pending.payload, bytes: new TextEncoder().encode(pending.payload).length };
    },
    async confirm(isPublicDocumentation) {
      const prepared = pending;
      pending = null;
      if (!prepared) return { ok: false, code: 'nothing-prepared', message: 'Nothing to send.', problems: [] };
      if (!isPublicDocumentation) {
        return { ok: false, code: 'not-confirmed', message: 'Nothing was sent: please confirm the text is public documentation.', problems: [] };
      }
      const token = await deps.consent.grant(prepared.payload);
      return deps.researcher.draft(prepared.request, token);
    },
    cancel() {
      pending = null;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Panel (DOM).

export interface ResearcherPanelDeps extends ResearcherControllerDeps {
  /** Files from the current rescue session that could not be converted (kept in memory only). */
  unconvertedFiles: () => SampleFile[];
  /** Fingerprints a sample file picked in the panel (taint registry), before anything else. */
  registerSample?: (bytes: Uint8Array) => void;
  /** Adds files read with a certified reader to the library. */
  addRescued: (results: RescueResult[], badge: InferenceBadge) => void;
}

async function readDocFile(file: File): Promise<string> {
  const text = await file.text();
  if (/\.html?$/i.test(file.name) || file.type === 'text/html') {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    return (doc.body?.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
  }
  return text;
}

export function mountResearcherPanel(root: HTMLElement, deps: ResearcherPanelDeps): void {
  clear(root);
  delete root.dataset.placeholder;
  const controller = createResearcherController(deps);

  let plugin: ReaderPlugin | null = null;
  let pluginBadge: InferenceBadge = 'UNKNOWN';
  let docNameUsed = '';
  let report: ConformanceReport | null = null;
  let extraSamples: SampleFile[] = [];

  const status = h('p', { class: 'small', attrs: { role: 'status' } });
  const docName = h('input', { id: 'research-doc-name', attrs: { type: 'text', placeholder: 'e.g. Notebook file format, version 3', autocomplete: 'off' } });
  const docText = h('textarea', { id: 'research-doc-text', attrs: { rows: 8, spellcheck: false, placeholder: 'Paste public documentation for the format here…' } });
  const docFile = h('input', { id: 'research-doc-file', attrs: { type: 'file', accept: '.txt,.md,.html,.htm,text/plain,text/markdown,text/html' } });
  const review = h('button', { class: 'btn', attrs: { type: 'button' }, text: 'Review what will be sent' });
  const draftArea = h('div', { class: 'research-draft', attrs: { 'aria-live': 'polite' } });
  const sampleList = h('ul', { class: 'research-samples' });
  const sampleFiles = h('input', { id: 'research-sample-files', attrs: { type: 'file', multiple: true } });
  const knownText = h('input', { id: 'research-known-text', attrs: { type: 'text', autocomplete: 'off', placeholder: 'e.g. a heading you remember' } });
  const runTests = h('button', { class: 'btn', attrs: { type: 'button', disabled: true }, text: 'Run tests on this computer' });
  const reportArea = h('div', { class: 'research-report', attrs: { 'aria-live': 'polite' } });
  const useReader = h('button', { class: 'btn btn-primary', attrs: { type: 'button', disabled: true }, text: 'Use this reader' });

  // Consent dialog.
  const payloadView = h('pre', { class: 'payload', attrs: { tabindex: 0, 'aria-label': 'Exact text that will be sent' } });
  const payloadBytes = h('p', { class: 'small muted' });
  const publicBox = h('input', { id: 'research-public', attrs: { type: 'checkbox' } });
  const send = h('button', { class: 'btn btn-primary', attrs: { type: 'button', disabled: true }, text: 'Send to cloud Gemini' });
  const cancel = h('button', { class: 'btn', attrs: { type: 'button' }, text: 'Cancel (send nothing)' });
  const dialog = h(
    'dialog',
    { class: 'consent-dialog', attrs: { 'aria-labelledby': 'consent-title', 'aria-describedby': 'consent-desc' } },
    h('h3', { id: 'consent-title', text: 'Send this documentation to cloud Gemini?' }),
    h('p', { id: 'consent-desc', class: 'small' }, 'This is ', h('strong', { text: 'exactly' }), ' what will be sent, together with the reply format. None of your files or their contents are included.'),
    payloadView,
    payloadBytes,
    h('p', {}, publicBox, ' ', h('label', { attrs: { for: 'research-public' }, text: 'This is public documentation I’m allowed to share.' })),
    h('div', { class: 'actions' }, send, ' ', cancel),
  );

  const refreshStatus = (): void => {
    const lane = controller.status();
    status.textContent = lane.message;
    status.className = `small ${lane.usable ? '' : 'muted'}`;
    review.disabled = !lane.usable;
  };

  const renderSamples = (): void => {
    clear(sampleList);
    const files = [...deps.unconvertedFiles(), ...extraSamples];
    if (files.length === 0) {
      sampleList.append(h('li', { class: 'muted small', text: 'No unconverted files in this session yet. Rescue a folder first, or add sample files below.' }));
    }
    files.forEach((file, index) => {
      const id = `research-sample-${index}`;
      sampleList.append(
        h('li', {}, h('input', { id, attrs: { type: 'checkbox', checked: true, 'data-index': index } }), ' ', h('label', { attrs: { for: id } }, h('code', { text: file.name }), ` (${file.bytes.length} bytes)`)),
      );
    });
    runTests.disabled = !plugin || files.length === 0;
  };

  const selectedSamples = (): SampleFile[] => {
    const files = [...deps.unconvertedFiles(), ...extraSamples];
    const boxes = Array.from(sampleList.querySelectorAll<HTMLInputElement>('input[type=checkbox]'));
    return boxes.filter((b) => b.checked).map((b) => files[Number(b.dataset.index)]).filter((f): f is SampleFile => !!f);
  };

  const showDraft = (outcome: ConfirmOutcome): void => {
    clear(draftArea);
    report = null;
    clear(reportArea);
    useReader.disabled = true;
    if (outcome.ok) {
      plugin = outcome.plugin;
      pluginBadge = outcome.badge;
      draftArea.append(
        h('p', {}, badgeChip(outcome.badge, 'Draft'), ' ', h('strong', { text: `Draft reader for “${outcome.plugin.formatName}”` }), ' — not used until it passes the tests below.'),
        h('details', {}, h('summary', { text: 'Show the drafted reader (data, not code)' }), h('pre', { class: 'plugin-json', text: JSON.stringify(outcome.plugin, null, 2) })),
      );
    } else {
      plugin = null;
      draftArea.append(h('p', { class: 'warning', text: outcome.message }));
      if (outcome.problems.length) draftArea.append(h('ul', {}, ...outcome.problems.slice(0, 12).map((p) => h('li', { text: p }))));
    }
    renderSamples();
  };

  const renderReport = (r: ConformanceReport): void => {
    clear(reportArea);
    reportArea.append(
      h('p', {}, h('strong', { text: r.passed ? 'All tests passed on this computer.' : 'Some tests failed, so this reader will not be used.' })),
      h(
        'table',
        { class: 'report' },
        h('thead', {}, h('tr', {}, h('th', { text: 'File' }), h('th', { text: 'Check' }), h('th', { text: 'Result' }), h('th', { text: 'Detail' }))),
        h(
          'tbody',
          {},
          ...r.checks.map((c) => h('tr', {}, h('td', {}, h('code', { text: c.file })), h('td', { text: c.id }), h('td', { class: c.passed ? 'pass' : 'fail', text: c.passed ? 'pass' : 'FAIL' }), h('td', { text: c.detail }))),
        ),
      ),
    );
    useReader.disabled = !r.passed;
  };

  docFile.addEventListener('change', () => {
    const file = docFile.files?.[0];
    if (!file) return;
    void readDocFile(file).then((text) => {
      docText.value = text;
      if (!docName.value.trim()) docName.value = file.name;
    });
  });

  review.addEventListener('click', () => {
    if (!controller.status().usable) return refreshStatus();
    if (!docText.value.trim()) {
      status.textContent = 'Paste or upload some public documentation first.';
      return;
    }
    const { payload, bytes } = controller.prepare(docName.value, docText.value);
    payloadView.textContent = payload;
    payloadBytes.textContent = `${bytes.toLocaleString('en')} bytes of text.`;
    publicBox.checked = false;
    send.disabled = true;
    dialog.showModal();
    payloadView.focus();
  });

  publicBox.addEventListener('change', () => {
    send.disabled = !publicBox.checked;
  });

  cancel.addEventListener('click', () => {
    controller.cancel();
    dialog.close();
    status.textContent = 'Cancelled. Nothing was sent.';
  });
  dialog.addEventListener('cancel', () => {
    controller.cancel();
    status.textContent = 'Cancelled. Nothing was sent.';
  });

  send.addEventListener('click', () => {
    const confirmed = publicBox.checked;
    docNameUsed = docName.value.trim() || 'Public format documentation';
    dialog.close();
    send.disabled = true;
    status.textContent = 'Asking cloud Gemini to draft a reader from the documentation…';
    void controller.confirm(confirmed).then((outcome) => {
      showDraft(outcome);
      refreshStatus();
      if (outcome.ok) status.textContent = 'Draft received. Choose sample files and run the tests on this computer.';
    });
  });

  sampleFiles.addEventListener('change', () => {
    const files = Array.from(sampleFiles.files ?? []);
    void Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))).then((loaded) => {
      for (const sample of loaded) deps.registerSample?.(sample.bytes);
      extraSamples = [...extraSamples, ...loaded];
      sampleFiles.value = '';
      renderSamples();
    });
  });

  runTests.addEventListener('click', () => {
    if (!plugin) return;
    report = deps.researcher.certify(plugin, selectedSamples(), { knownText: knownText.value });
    renderReport(report);
  });

  useReader.addEventListener('click', () => {
    if (!plugin || !report?.passed) return;
    const current = plugin;
    useReader.disabled = true;
    void Promise.all(selectedSamples().map((s) => deps.researcher.apply(current, s, { docName: docNameUsed, badge: pluginBadge }))).then((results) => {
      deps.addRescued(results, pluginBadge);
      status.textContent = `Added ${results.length} file${results.length === 1 ? '' : 's'} to your library, read on this device.`;
    });
  });

  window.addEventListener('online', refreshStatus);
  window.addEventListener('offline', refreshStatus);

  root.append(
    h(
      'div',
      { class: 'research-intro small' },
      h('p', {}, h('strong', { text: 'What is sent: ' }), 'only the documentation text you paste or upload here, after you review it.'),
      h('p', {}, h('strong', { text: 'Never sent: ' }), 'your files, their bytes or their contents. The drafted reader is tested and used on this device.'),
    ),
    status,
    h('p', {}, h('label', { attrs: { for: 'research-doc-name' }, text: 'Document name ' }), docName),
    h('p', {}, h('label', { attrs: { for: 'research-doc-text' }, text: 'Public documentation' }), h('br'), docText),
    h('p', { class: 'small' }, h('label', { attrs: { for: 'research-doc-file' }, text: 'or load a spec file (.txt, .md, .html): ' }), docFile),
    h('p', {}, review),
    dialog,
    draftArea,
    h('h3', { text: 'Test on your files (on this computer)' }),
    sampleList,
    h('p', { class: 'small' }, h('label', { attrs: { for: 'research-sample-files' }, text: 'Add sample files: ' }), sampleFiles),
    h(
      'p',
      { class: 'small' },
      h('label', { attrs: { for: 'research-known-text' }, text: 'A word or phrase you know is in these files (recommended, checked on this computer): ' }),
      knownText,
    ),
    h('p', {}, runTests, ' ', useReader),
    reportArea,
  );
  refreshStatus();
  renderSamples();

  // Let the app refresh the sample list after a rescue run.
  root.addEventListener('reopen:session-changed', renderSamples);
}
