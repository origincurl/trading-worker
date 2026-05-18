// Single entry in the collector's observation universe. `source` records
// who put it there (admin-curated, FE-observed, or both) so collector can
// emit per-source metrics in its heartbeat. `instrumentType` lets the
// universe layer route stock and ETF symbols through the same channels
// while preserving metadata for downstream consumers.
export type ObservedSymbolSource = 'ADMIN' | 'FE' | 'BOTH';

export type ObservedInstrumentType = 'STOCK' | 'ETF';

export interface ObservedSymbolModel {
  readonly symbol: string;
  readonly source: ObservedSymbolSource;
  readonly instrumentType: ObservedInstrumentType;
}
