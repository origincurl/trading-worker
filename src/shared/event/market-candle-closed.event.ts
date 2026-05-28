import type { MarketTickMarket, MarketTickProvider } from './market-tick.event';

// `market.candle.closed` is delivered via Redis Streams (BUS_STREAMS), not
// pub/sub — calculator and BE consumers need replay semantics. dedup key is
// (provider, marketEnv, symbol, intervalType, bucketStart).
export const MARKET_CANDLE_CLOSED_EVENT_TYPE = 'market.candle.closed';
export const MARKET_CANDLE_CLOSED_SCHEMA_VERSION = 1;
export const MARKET_CANDLE_CLOSED_STREAM = 'market.candle.closed';

export type CandleInterval = '1m';
export type CandleChartSource = 'trade_tick_0B' | 'broker_chart_REST' | 'broker_chart_AL' | 'unknown';
export type CandleChartMarket = 'KRW' | 'AL' | 'NXT' | 'UNKNOWN';

export interface MarketCandleClosedPayload {
  readonly provider: MarketTickProvider;
  readonly marketEnv: 'mock' | 'production';
  readonly symbol: string;
  readonly market: MarketTickMarket;
  readonly chartSource: CandleChartSource;
  readonly chartMarket: CandleChartMarket;
  readonly intervalType: CandleInterval;
  readonly bucketStart: string;
  readonly bucketEnd: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly tradingValue?: number | null;
  readonly tickCount: number;
  readonly firstSourceTs: string;
  readonly lastSourceTs: string;
  readonly cumulativeVolumeFirst: number | null;
  readonly cumulativeVolumeLast: number | null;
  readonly cumulativeVolumeAnomalies: number;
  // `realtime` ingests came off WS; `catchup` from chart REST (Phase 6.10).
  // PK upsert in the repo treats realtime as the source of truth — catchup
  // never overwrites a realtime candle for the same bucket.
  readonly dataSource: 'realtime' | 'catchup';
}

export function marketCandleClosedChannel(
  provider: MarketTickProvider,
  marketEnv: 'mock' | 'production',
  symbol: string,
  intervalType: CandleInterval,
): string {
  return `market.candle.closed.${provider}.${marketEnv}.${symbol}.${intervalType}`;
}
