import type { Block } from '../types';

/** Escapes characters that would otherwise start Markdown syntax at the beginning of a line. */
function escapeLineStart(line: string): string {
  return line
    .replace(/^(\s*)(\d+)([.)])/, (_m, space: string, digits: string, punct: string) => `${space}${digits}\\${punct}`)
    .replace(/^(\s*)([#>+\-*=`|])/, (_m, space: string, marker: string) => `${space}\\${marker}`);
}

function escapeInline(text: string): string {
  return text
    .split('\n')
    .map((line) => escapeLineStart(line.replace(/([\\`*_[\]<>])/g, '\\$1')))
    .join('  \n'); // keep line breaks inside a paragraph
}

export interface MarkdownOptions {
  title?: string;
  /** Shown as a blockquote under the title, e.g. "Recovered text, not reconstructed". */
  note?: string;
}

export function blocksToMarkdown(blocks: Block[], options: MarkdownOptions = {}): string {
  const parts: string[] = [];
  if (options.title) parts.push(`# ${escapeInline(options.title)}`);
  if (options.note) parts.push(`> ${escapeInline(options.note)}`);
  let orderedIndex = 0;
  // undefined = not in a list; otherwise whether the current list is ordered.
  let currentList: boolean | undefined;
  for (const block of blocks) {
    if (block.type === 'list-item') {
      const continues = currentList === block.ordered;
      orderedIndex = continues ? orderedIndex + 1 : 1;
      const item = `${block.ordered ? `${orderedIndex}.` : '-'} ${escapeInline(block.text).replace(/\n/g, '\n   ')}`;
      if (continues) parts[parts.length - 1] += `\n${item}`;
      else parts.push(item); // a change of list type starts a new list
      currentList = block.ordered;
      continue;
    }
    currentList = undefined;
    if (block.type === 'heading') parts.push(`${'#'.repeat(block.level)} ${escapeInline(block.text)}`);
    else parts.push(escapeInline(block.text));
  }
  return `${parts.join('\n\n')}\n`;
}
