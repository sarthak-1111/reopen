import type { AiService, LedgerEntry } from '../ai/contract';
import { badgeChip } from './cards';
import { clear, downloadBytes, h } from './dom';
import { formatBytes } from './view-model';

const OUTCOME_LABEL: Record<LedgerEntry['outcome'], string> = { sending: 'Sending…', ok: 'Sent', error: 'Failed' };

function entryRow(entry: LedgerEntry): HTMLElement {
  const time = new Date(entry.at);
  return h(
    'li',
    { class: `ledger-entry outcome-${entry.outcome}` },
    h(
      'div',
      { class: 'ledger-head' },
      h('strong', { text: entry.feature }),
      ' ',
      badgeChip(entry.badge, entry.feature),
      h('span', { class: 'muted small', text: ` ${Number.isNaN(time.getTime()) ? entry.at : time.toLocaleTimeString()} · ${entry.model} · ${formatBytes(entry.bytes)} · ${OUTCOME_LABEL[entry.outcome]}` }),
    ),
    h('details', {}, h('summary', { text: 'Exactly what was sent' }), h('pre', { text: entry.sentText, attrs: { tabindex: 0 } })),
  );
}

/** The Privacy Ledger: every cloud call, with the exact text that was sent. */
export function mountLedgerPanel(root: HTMLElement, ai: AiService): () => void {
  const render = (): void => {
    const entries = ai.ledger();
    clear(root);
    if (entries.length === 0) {
      root.append(
        h('p', { class: 'ledger-empty' }, h('strong', { text: '0 cloud calls this session.' }), ' Nothing has left this device.'),
      );
      return;
    }
    root.append(
      h('p', {}, h('strong', { text: `${entries.length} cloud call${entries.length === 1 ? '' : 's'} this session.` }), ' Each one contains public documentation you chose to share — never your files.'),
      h('ol', { class: 'ledger-list', attrs: { reversed: true } }, ...[...entries].reverse().map(entryRow)),
      h('button', {
        class: 'btn btn-quiet',
        text: 'Export ledger (.json)',
        attrs: { type: 'button' },
        on: { click: () => downloadBytes(new TextEncoder().encode(JSON.stringify(entries, null, 2)), 'reopen-privacy-ledger.json', 'application/json') },
      }),
    );
  };
  render();
  return ai.onLedgerChange(render);
}
