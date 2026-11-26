import type { ConversionLevel, FormatId } from './types';

export interface CatalogueEntry {
  originalPath: string;
  newName: string;
  format: FormatId;
  /** Display name for a format identified by a researched reader (shown instead of the id). */
  formatName?: string;
  evidence: string[];
  encoding?: string;
  conversionLevel: ConversionLevel;
  outputs: { path: string; mime: string }[];
  warnings: string[];
  /** Where the AI step (if any) ran, as reported by the SDK. */
  aiSource?: 'on_device' | 'in_cloud' | null;
  summary?: string;
}

export interface CatalogueMeta {
  title: string;
  createdAt: string;
  filesProcessedOnDevice: number;
  cloudCalls: number;
}

const LEVEL_LABEL: Record<ConversionLevel, string> = {
  full: 'Full conversion',
  'text-and-paragraphs': 'Text and paragraphs (no formatting)',
  'text-recovery': 'Text recovery (raw, best effort)',
  none: 'Not converted',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function href(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** A self-contained index.html: no scripts, no external resources. */
export function buildCatalogueHtml(entries: CatalogueEntry[], meta: CatalogueMeta): string {
  const rows = entries
    .map((e) => {
      const outputs = e.outputs.map((o) => `<a href="${escapeHtml(href(o.path))}">${escapeHtml(o.path.split('/').pop() ?? o.path)}</a>`).join('<br>');
      const evidence = e.evidence.map((x) => `<li>${escapeHtml(x)}</li>`).join('');
      const warnings = e.warnings.length ? `<ul class="warn">${e.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : '';
      const ai = e.aiSource === 'on_device' ? 'ON DEVICE' : e.aiSource === 'in_cloud' ? 'CLOUD' : 'No AI';
      return `<tr>
  <td><strong>${escapeHtml(e.newName)}</strong>${e.summary ? `<p>${escapeHtml(e.summary)}</p>` : ''}</td>
  <td><code>${escapeHtml(e.originalPath)}</code></td>
  <td>${escapeHtml(e.formatName ?? e.format)}<details><summary>Why</summary><ul>${evidence}</ul></details></td>
  <td>${escapeHtml(e.encoding ?? '—')}</td>
  <td>${escapeHtml(LEVEL_LABEL[e.conversionLevel])}${warnings}</td>
  <td>${escapeHtml(ai)}</td>
  <td>${outputs || '—'}</td>
</tr>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title)}</title>
<style>
:root { color-scheme: light dark; --bg: #f7f3ec; --fg: #1d1b18; --muted: #5d5850; --line: #d9d1c3; }
@media (prefers-color-scheme: dark) { :root { --bg: #1b1916; --fg: #efe9df; --muted: #b3ab9d; --line: #3a362f; } }
body { font: 15px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0 auto; max-width: 1200px; padding: 24px 16px; }
table { border-collapse: collapse; width: 100%; }
th, td { border-bottom: 1px solid var(--line); padding: 8px; text-align: left; vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
td p { margin: 4px 0 0; color: var(--muted); }
code { font-size: 0.85em; overflow-wrap: anywhere; }
.warn { margin: 4px 0 0; padding-left: 16px; color: var(--muted); }
.table-wrap { overflow-x: auto; }
</style>
</head>
<body>
<h1>${escapeHtml(meta.title)}</h1>
<p>${entries.length} files · created ${escapeHtml(meta.createdAt)} · ${meta.filesProcessedOnDevice} processed on this device · ${meta.cloudCalls} cloud calls</p>
<div class="table-wrap"><table>
<thead><tr><th>Name</th><th>Original</th><th>Detected format</th><th>Encoding</th><th>Conversion</th><th>AI</th><th>Files</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>
</body>
</html>
`;
}

export function buildRescueReport(entries: CatalogueEntry[], meta: CatalogueMeta): string {
  const counts = new Map<ConversionLevel, number>();
  for (const e of entries) counts.set(e.conversionLevel, (counts.get(e.conversionLevel) ?? 0) + 1);
  const lines = [
    `# ${meta.title}`,
    '',
    `Created ${meta.createdAt}. ${entries.length} files examined.`,
    `Files processed on this device: ${meta.filesProcessedOnDevice}. Cloud calls: ${meta.cloudCalls}.`,
    '',
    '## Summary',
    '',
    ...(['full', 'text-and-paragraphs', 'text-recovery', 'none'] as ConversionLevel[]).map(
      (level) => `- ${LEVEL_LABEL[level]}: ${counts.get(level) ?? 0}`,
    ),
    '',
    '## Files',
    '',
  ];
  for (const e of entries) {
    lines.push(`### ${e.newName}`, '');
    lines.push(`- Original: \`${e.originalPath}\``);
    lines.push(`- Detected format: ${e.formatName ?? e.format}${e.encoding ? ` (encoding ${e.encoding})` : ''}`);
    lines.push(`- Conversion: ${LEVEL_LABEL[e.conversionLevel]}`);
    lines.push(`- AI: ${e.aiSource === 'on_device' ? 'on device' : e.aiSource === 'in_cloud' ? 'cloud' : 'none'}`);
    if (e.outputs.length) lines.push(`- Outputs: ${e.outputs.map((o) => `\`${o.path}\``).join(', ')}`);
    lines.push(`- Evidence: ${e.evidence.join(' ')}`);
    for (const w of e.warnings) lines.push(`- Warning: ${w}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
