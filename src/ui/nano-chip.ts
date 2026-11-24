import type { AiService, NanoState } from '../ai/contract';
import { clear, h } from './dom';

export const NANO_TEXT: Record<NanoState, { label: string; detail: string; canWake: boolean }> = {
  available: { label: 'On-device AI ready', detail: 'Gemini Nano runs in this browser. It works offline and nothing it reads leaves this device.', canWake: false },
  downloadable: { label: 'On-device AI available', detail: 'Chrome can download Gemini Nano once. After that it works offline.', canWake: true },
  downloading: { label: 'On-device AI downloading', detail: 'Chrome is downloading Gemini Nano. Files still convert meanwhile.', canWake: true },
  unavailable: { label: 'On-device AI not supported here', detail: 'This device can’t run Gemini Nano. Conversion still works; recovered text is shown raw.', canWake: false },
  'no-api': { label: 'No on-device AI in this browser', detail: 'Use desktop Chrome for on-device AI. Conversion still works; recovered text is shown raw.', canWake: false },
  'not-configured': { label: 'On-device AI not set up', detail: 'Conversion works without AI; recovered text is shown raw.', canWake: false },
};

/** Status chip + "Wake on-device AI" button. Returns a refresh function. */
export function mountNanoChip(root: HTMLElement, ai: AiService, onStateChange?: (state: NanoState) => void): () => Promise<void> {
  let busy = false;

  const render = (state: NanoState, progress?: number, error?: string): void => {
    const text = NANO_TEXT[state];
    clear(root);
    const dot = h('span', { class: `dot dot-${state}`, attrs: { 'aria-hidden': 'true' } });
    root.append(h('span', { class: 'nano-label' }, dot, h('strong', { text: text.label })), h('span', { class: 'nano-detail small', text: error ?? text.detail }));
    if (progress !== undefined) {
      root.append(h('progress', { attrs: { max: 1, value: progress, 'aria-label': 'Gemini Nano download progress' } }));
    }
    if (text.canWake) {
      root.append(
        h('button', {
          class: 'btn btn-small',
          text: busy ? 'Waking…' : 'Wake on-device AI',
          attrs: { type: 'button', disabled: busy },
          on: { click: () => void wake() },
        }),
      );
    }
  };

  const refresh = async (): Promise<void> => {
    let state: NanoState;
    try {
      state = await ai.nanoState();
    } catch {
      state = 'unavailable';
    }
    render(state);
    onStateChange?.(state);
  };

  const wake = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    render('downloading', 0);
    try {
      await ai.warmUp((fraction) => render('downloading', fraction));
    } catch (error) {
      busy = false;
      render('downloadable', undefined, `Couldn’t start the download: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    busy = false;
    await refresh();
  };

  void refresh();
  return refresh;
}
