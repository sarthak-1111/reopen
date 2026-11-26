import type { OutputFile } from '../core/types';
import type { InferenceBadge } from '../ai/contract';
import { h, objectUrl } from './dom';
import {
  allOutputs,
  badgeLabel,
  encodingLabel,
  extensionOf,
  fileNameOf,
  formatBytes,
  formatLabel,
  LEVEL_LABEL,
  LEVEL_TONE,
  parseCsvPreview,
  pictureOutputs,
  previewKind,
  primaryPreview,
  reconstructionUsable,
  type RescuedItem,
} from './view-model';

const PREVIEW_CHARS = 1200;

export function badgeChip(badge: InferenceBadge, context?: string): HTMLElement {
  const tone = badge === 'ON_DEVICE' ? 'device' : badge === 'CLOUD' ? 'cloud' : badge === 'UNKNOWN' ? 'unknown' : 'none';
  const label = badgeLabel(badge);
  return h('span', {
    class: `badge badge-${tone}`,
    text: label,
    attrs: { title: context ? `${context}: ${label}` : label, 'aria-label': context ? `${context} ran: ${label.toLowerCase()}` : label },
  });
}

function decodePreview(output: OutputFile): string {
  const text = new TextDecoder().decode(output.bytes.subarray(0, PREVIEW_CHARS * 4)).replace(/^﻿/, '');
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

function preview(output: OutputFile | undefined): HTMLElement | null {
  if (!output) return null;
  const kind = previewKind(output);
  const caption = h('figcaption', { text: `Preview of ${output.name}` });
  if (kind === 'image') {
    return h('figure', { class: 'preview preview-image' }, h('img', { attrs: { src: objectUrl(output.bytes, output.mime), alt: `Converted picture ${output.name}`, loading: 'lazy', decoding: 'async' } }), caption);
  }
  if (kind === 'csv') {
    const rows = parseCsvPreview(new TextDecoder().decode(output.bytes.subarray(0, 64 * 1024)));
    const [head, ...body] = rows;
    const table = h(
      'table',
      {},
      head ? h('thead', {}, h('tr', {}, ...head.map((cell) => h('th', { text: cell, attrs: { scope: 'col' } })))) : null,
      h('tbody', {}, ...body.map((row) => h('tr', {}, ...row.map((cell) => h('td', { text: cell }))))),
    );
    return h('figure', { class: 'preview preview-table' }, h('div', { class: 'table-scroll', attrs: { tabindex: 0, role: 'region', 'aria-label': `Table preview of ${output.name}` } }, table), caption);
  }
  if (kind === 'text') {
    return h('figure', { class: 'preview preview-text' }, h('pre', { text: decodePreview(output), attrs: { tabindex: 0, 'aria-label': `Text preview of ${output.name}` } }), caption);
  }
  return null;
}

function previews(item: RescuedItem): HTMLElement | null {
  const outputs = allOutputs(item);
  const primary = primaryPreview(outputs, item.result.detected.family);
  const pictures = pictureOutputs(outputs, primary);
  const main = preview(primary);
  if (pictures.length === 0) return main;
  const strip = h(
    'figure',
    { class: 'preview picture-strip' },
    h(
      'div',
      { class: 'thumbs' },
      ...pictures.slice(0, 6).map((p) => h('img', { attrs: { src: objectUrl(p.bytes, p.mime), alt: `Picture from the document: ${p.name}`, loading: 'lazy', decoding: 'async' } })),
    ),
    h('figcaption', { text: `${pictures.length} picture${pictures.length === 1 ? '' : 's'} from the document` }),
  );
  return h('div', {}, main, strip);
}

function downloads(item: RescuedItem): HTMLElement {
  const outputs = allOutputs(item);
  if (outputs.length === 0) return h('p', { class: 'muted', text: 'No files could be produced from this one.' });
  return h(
    'ul',
    { class: 'downloads', attrs: { 'aria-label': `Downloads for ${item.finalName}` } },
    ...outputs.map((output) =>
      h(
        'li',
        {},
        h('a', {
          class: 'btn btn-small',
          text: `.${extensionOf(output.name) || 'file'}`,
          attrs: { href: objectUrl(output.bytes, output.mime), download: output.name, title: output.name, 'aria-label': `Download ${output.name} (${formatBytes(output.bytes.length)})` },
        }),
      ),
    ),
  );
}

function aiSection(item: RescuedItem): HTMLElement | null {
  const insight = item.insight;
  if (!insight) return null;
  const parts: (HTMLElement | null)[] = [];
  if (insight.summary) {
    parts.push(h('p', { class: 'summary' }, badgeChip(insight.badge, 'Summary'), ' ', insight.summary[0], h('br'), insight.summary[1]));
  }
  if (item.nameSource === 'ai') {
    parts.push(h('p', { class: 'muted small' }, 'Name suggested ', insight.badge === 'ON_DEVICE' ? 'on this device' : 'by AI', ' ', badgeChip(insight.badge, 'Naming')));
  }
  if (insight.category && insight.badge !== 'NO_AI') parts.push(h('p', { class: 'muted small', text: `Looks like: ${insight.category}` }));
  return parts.length ? h('div', { class: 'ai-area' }, ...parts) : null;
}

function recoveredSection(item: RescuedItem): HTMLElement | null {
  const { result, reconstruction } = item;
  if (result.conversionLevel !== 'text-recovery' || !result.recoveredText) return null;
  const raw = h(
    'details',
    { class: 'raw-text', attrs: { open: !reconstructionUsable(reconstruction) } },
    h('summary', {}, h('span', { class: 'label-raw', text: 'Raw recovered text' }), ' — exactly as found, nothing added'),
    h('pre', { text: result.recoveredText.slice(0, 4000) + (result.recoveredText.length > 4000 ? '…' : ''), attrs: { tabindex: 0 } }),
  );
  if (!reconstruction) return h('div', { class: 'recovered' }, raw);

  const check = reconstruction.noInvention.ok
    ? h('p', { class: 'check check-ok', text: 'No-invention check passed: every word comes from the recovered text.' })
    : h('p', { class: 'check check-fail', text: `No-invention check failed (${reconstruction.noInvention.inventedTokens.length} new word(s)) → showing raw text instead.` });

  if (!reconstructionUsable(reconstruction)) {
    return h('div', { class: 'recovered' }, raw, reconstruction.mode === 'ai-structured' ? check : null);
  }
  const blocks = reconstruction.blocks.map((block) =>
    block.kind === 'heading' ? h('h4', { text: block.text }) : block.kind === 'list-item' ? h('p', { class: 'list-item', text: `• ${block.text}` }) : h('p', { text: block.text }),
  );
  return h(
    'div',
    { class: 'recovered' },
    h('div', { class: 'reconstruction' }, h('p', { class: 'small' }, h('strong', { text: 'Reconstructed paragraphs ' }), badgeChip(reconstruction.badge, 'Reconstruction')), check, h('div', { class: 'reconstructed-text' }, ...blocks)),
    raw,
  );
}

export function renderCard(item: RescuedItem, index: number): HTMLElement {
  const { result } = item;
  const titleId = `card-title-${item.id}`;
  const tone = LEVEL_TONE[result.conversionLevel];
  const encoding = encodingLabel(result.encoding?.encoding);
  const badge: InferenceBadge = item.insight?.badge ?? 'NO_AI';
  const sheetInfo = result.sheets?.length ? `${result.sheets.length} sheet${result.sheets.length > 1 ? 's' : ''}` : undefined;

  const card = h(
    'article',
    { class: `card tone-${tone}`, attrs: { 'aria-labelledby': titleId, style: `--i:${Math.min(index, 12)}` } },
    h(
      'header',
      { class: 'card-head' },
      h('h3', { id: titleId, text: item.finalName }),
      h('div', { class: 'chips' }, h('span', { class: `chip level-${tone}`, text: LEVEL_LABEL[result.conversionLevel] }), badgeChip(badge, 'AI')),
    ),
    h('p', { class: 'origin small' }, 'was ', h('code', { text: item.originalPath }), ` · ${formatBytes(result.source.size)}`),
    h(
      'dl',
      { class: 'facts' },
      h('dt', { text: 'Format' }),
      h('dd', { text: result.detected.label ?? formatLabel(result.detected.format) }),
      encoding ? h('dt', { text: 'Encoding' }) : null,
      encoding ? h('dd', { text: encoding }) : null,
      sheetInfo ? h('dt', { text: 'Contents' }) : null,
      sheetInfo ? h('dd', { text: sheetInfo }) : null,
    ),
    h(
      'details',
      { class: 'evidence' },
      h('summary', { text: 'How Reopen recognised it' }),
      h('ul', {}, ...result.detected.evidence.map((line) => h('li', { text: line }))),
      h('p', { class: 'small muted', text: 'Detected from the bytes inside the file, not from its name.' }),
    ),
    aiSection(item),
    result.conversionLevel === 'text-recovery' ? null : previews(item),
    recoveredSection(item),
    result.warnings.length
      ? h('details', { class: 'warnings' }, h('summary', { text: `Notes (${result.warnings.length})` }), h('ul', {}, ...result.warnings.map((w) => h('li', { text: w }))))
      : null,
    downloads(item),
  );
  return card;
}

/** A card for a file that failed completely (the core never throws, so this is rare). */
export function renderFailedCard(path: string, size: number, message: string): HTMLElement {
  return h(
    'article',
    { class: 'card tone-none', attrs: { 'aria-label': `Could not rescue ${fileNameOf(path)}` } },
    h('header', { class: 'card-head' }, h('h3', { text: fileNameOf(path) }), h('div', { class: 'chips' }, h('span', { class: 'chip level-none', text: 'Failed' }))),
    h('p', { class: 'origin small' }, h('code', { text: path }), ` · ${formatBytes(size)}`),
    h('p', { class: 'check check-fail', text: message }),
  );
}
