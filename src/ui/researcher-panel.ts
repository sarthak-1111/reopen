import { clear, h } from './dom';

/**
 * PLACEHOLDER — the main thread replaces this with the real opt-in format researcher
 * (cloud lane, public documentation only, local conformance tests). It is mounted into
 * #format-researcher-root and must never receive file bytes or file contents.
 */
export function mountResearcherPlaceholder(root: HTMLElement): void {
  clear(root);
  root.dataset.placeholder = 'true';
  root.append(
    h(
      'p',
      { class: 'muted' },
      'When a file’s format is unknown, you will be able to paste or upload its ',
      h('strong', { text: 'public documentation' }),
      '. Cloud Gemini drafts a reader from that documentation only; the reader is used after it passes tests on your files, here on this device. ',
      h('em', { text: 'Not connected in this build yet.' }),
    ),
  );
}
