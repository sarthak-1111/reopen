import * as CFBNamespace from 'cfb';
import * as EncodingNamespace from 'encoding-japanese';

/**
 * Some dependencies are CommonJS. Bundlers and Node expose them differently
 * (`import * as X` may only carry `default`). This picks whichever object holds the API.
 */
function pickApi<T extends object>(namespace: T, probe: string): T {
  const candidate = namespace as unknown as Record<string, unknown> & { default?: unknown };
  if (typeof candidate[probe] === 'function') return namespace;
  const fallback = candidate.default as Record<string, unknown> | undefined;
  if (fallback && typeof fallback[probe] === 'function') return fallback as unknown as T;
  throw new Error(`Dependency API not found (missing ${probe}).`);
}

export const CFB = pickApi(CFBNamespace, 'read');
export const EncodingJapanese = pickApi(EncodingNamespace, 'detect');
