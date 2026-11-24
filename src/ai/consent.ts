/**
 * Single-use consent for one exact cloud payload. The UI shows the user the exact text that
 * would be sent; only after they confirm is a token granted for that text's SHA-256. The gate
 * consumes the token, so every cloud call needs fresh consent and a changed payload is refused.
 */
export interface ConsentStore {
  grant(payload: string): Promise<string>;
  consume(token: string, payload: string): Promise<boolean>;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createConsentStore(): ConsentStore {
  const granted = new Map<string, string>();
  let counter = 0;
  return {
    async grant(payload) {
      counter += 1;
      const token = `consent-${counter}-${Math.random().toString(36).slice(2)}`;
      granted.set(token, await sha256Hex(payload));
      return token;
    },
    async consume(token, payload) {
      const hash = granted.get(token);
      granted.delete(token);
      return hash !== undefined && hash === (await sha256Hex(payload));
    },
  };
}
