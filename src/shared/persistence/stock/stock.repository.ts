import type { StockModel } from '@shared/model/stock/stock.model';

// Input for upserting a vendor-fetched stock master row. Worker collector
// calls upsertMany(...) on the stock-list sync cycle. Unique key is
// (marketId, symbol) — same as the DB partial unique constraint where
// deleted_at IS NULL.
export interface UpsertStockInput {
  readonly marketId: number;
  readonly symbol: string;
  readonly name: string;
  readonly englishName?: string | null;
  readonly sector?: string | null;
  readonly industry?: string | null;
  readonly currency?: string | null;
  readonly isActive: boolean;
  readonly isTradable: boolean;
  readonly listedAt?: Date | null;
  readonly delistedAt?: Date | null;
  readonly metadata?: Record<string, unknown> | null;
}

export interface StockRepository {
  // Admin-observed universe (is_observed=true, soft-deleted excluded).
  findObservedStocks(): Promise<StockModel[]>;
  findBySymbol(symbol: string): Promise<StockModel | null>;
  findById(id: number): Promise<StockModel | null>;
  // External key = (marketCode, symbol). Resolves to internal id without
  // forcing callers to model the join themselves — worker hot paths
  // (executor, tracker) just need an id.
  findIdByExternalKey(marketCode: string, symbol: string): Promise<number | null>;
  // Vendor master upsert. Returns counts so the collector can log
  // per-cycle deltas. is_observed is intentionally never touched here —
  // admin owns that flag.
  upsertMany(rows: readonly UpsertStockInput[]): Promise<{ inserted: number; updated: number }>;
}
