// Snapshot of approved trade-universe symbols issued by BE control-plane.
// `version` is monotonic — collector diffs against last applied to decide
// REG/REMOVE. `marketEnv` must match the worker's KIWOOM_MARKET_ENV or the
// snapshot is rejected (architecture.md §10: env isolation).
export interface UniverseSymbolEntry {
  readonly symbol: string;
  readonly market: 'KOSPI' | 'KOSDAQ' | 'KONEX' | 'NXT' | 'unknown' | null;
}

export interface UniverseLeaseModel {
  readonly leaseId: string;
  readonly marketEnv: 'mock' | 'production';
  readonly version: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly symbols: readonly UniverseSymbolEntry[];
}
