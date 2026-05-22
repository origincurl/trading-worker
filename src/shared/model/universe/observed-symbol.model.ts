// Single entry in the collector's observation universe. `source` is retained
// for source attribution. Canonical WS demand comes from FE chart observation
// and active strategy demand. Admin-curated symbols must not feed the broker WS
// universe. `instrumentType` lets the universe layer route stock and ETF
// symbols through the same channels while preserving metadata for downstream
// consumers.
export type ObservedSymbolSource = 'CHART' | 'STRATEGY' | 'BOTH';

export type ObservedInstrumentType = 'STOCK' | 'ETF';

export interface ObservedSymbolModel {
  readonly symbol: string;
  readonly source: ObservedSymbolSource;
  readonly instrumentType: ObservedInstrumentType;
}
