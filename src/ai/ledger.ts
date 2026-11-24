import type { InferenceBadge, LedgerEntry } from './contract';

export interface Ledger {
  entries(): readonly LedgerEntry[];
  /** Records a cloud call BEFORE it is sent; returns its id. */
  record(entry: Omit<LedgerEntry, 'id' | 'at' | 'bytes' | 'outcome' | 'badge'>): string;
  settle(id: string, outcome: LedgerEntry['outcome'], badge: InferenceBadge): void;
  onChange(listener: () => void): () => void;
}

/** In-memory Privacy Ledger. Nothing is persisted or uploaded. */
export function createLedger(now: () => Date = () => new Date()): Ledger {
  const entries: LedgerEntry[] = [];
  const listeners = new Set<() => void>();
  const emit = (): void => listeners.forEach((listener) => listener());
  let counter = 0;

  return {
    entries: () => entries,
    record(entry) {
      counter += 1;
      const id = `cloud-${counter}`;
      entries.push({
        ...entry,
        id,
        at: now().toISOString(),
        bytes: new TextEncoder().encode(entry.sentText).length,
        outcome: 'blocked',
        badge: 'UNKNOWN',
      });
      emit();
      return id;
    },
    settle(id, outcome, badge) {
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry) return;
      entry.outcome = outcome;
      entry.badge = badge;
      emit();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
