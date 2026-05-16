import type { MarketCandleClosedPayload } from '@shared/event/market-candle-closed.event';

export interface CandleRepository {
  // Upsert with realtime-priority policy. Returns whether the row was
  // newly inserted, updated, or skipped (existing realtime row beats
  // incoming backfill).
  upsertClosed(payload: MarketCandleClosedPayload): Promise<'inserted' | 'updated' | 'skipped'>;
}

export const CANDLE_REPOSITORY = Symbol('CANDLE_REPOSITORY');
