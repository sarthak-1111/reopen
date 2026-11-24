/** Tiny DOM builder. Text is always set as text nodes, never as HTML, so file content can't inject markup. */

type Child = Node | string | number | false | null | undefined;

export interface Props {
  class?: string;
  id?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[K]) => void }>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.id) el.id = props.id;
  if (props.text !== undefined) el.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (value === undefined || value === false) continue;
    el.setAttribute(name, value === true ? '' : String(value));
  }
  for (const [event, handler] of Object.entries(props.on ?? {})) {
    el.addEventListener(event, handler as EventListener);
  }
  append(el, ...children);
  return el;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Object URLs created for previews and downloads; revoked when a new rescue starts. */
const urls = new Set<string>();

export function objectUrl(bytes: Uint8Array, mime: string): string {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  urls.add(url);
  return url;
}

export function revokeAllObjectUrls(): void {
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
}

/** Starts a download of in-memory bytes. */
export function downloadBytes(bytes: Uint8Array, name: string, mime: string): void {
  const a = h('a', { attrs: { href: objectUrl(bytes, mime), download: name } });
  document.body.append(a);
  a.click();
  a.remove();
}

export const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
