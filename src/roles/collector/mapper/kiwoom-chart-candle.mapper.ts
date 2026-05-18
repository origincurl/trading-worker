import type { CandleInterval } from '@shared/event/market-candle-closed.event';
import type { MarketCandleClosedPayload } from '@shared/event/market-candle-closed.event';

// Kiwoom chart REST response → MarketCandleClosedPayload[].
// Phase 6.10 scope: the mapping shape is defined, but the parser body is
// deferred until the real Kiwoom chart contract lands. Real impl will
// consume `KiwoomChartCandleResponse` (in `contract/response/`) and
// produce one payload per row.

export interface KiwoomChartResponseRow {
  readonly bucketStart: string;
  readonly bucketEnd: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface ChartCandleMapperContext {
  readonly provider: 'kiwoom';
  readonly marketEnv: 'mock' | 'production';
  readonly symbol: string;
  readonly intervalType: CandleInterval;
}

export function rowToCandlePayload(
  row: KiwoomChartResponseRow,
  ctx: ChartCandleMapperContext,
): MarketCandleClosedPayload {
  return {
    provider: ctx.provider,
    marketEnv: ctx.marketEnv,
    symbol: ctx.symbol,
    market: null,
    intervalType: ctx.intervalType,
    bucketStart: row.bucketStart,
    bucketEnd: row.bucketEnd,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    // Catchup rows are aggregated — we don't have per-tick context.
    tickCount: 0,
    firstSourceTs: row.bucketStart,
    lastSourceTs: row.bucketEnd,
    cumulativeVolumeFirst: null,
    cumulativeVolumeLast: null,
    cumulativeVolumeAnomalies: 0,
    dataSource: 'catchup',
  };
}
