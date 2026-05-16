// Wire format for live tick fan-out via Redis Pub/Sub.
// architecture.md §8: pubsub is volatile fan-out — BE WS gateway subscribes
// to `market.tick.{provider}.{marketEnv}.{symbol}` and forwards to FE.
//
// model fields are deliberately wire-friendly (ISO8601 strings, no Date
// objects) because pubsub payloads are JSON-serialized in transit.
export type MarketTickProvider = 'kiwoom';

export type MarketTickMarket = 'KOSPI' | 'KOSDAQ' | 'KONEX' | 'NXT' | 'unknown' | null;

export const MARKET_TICK_EVENT_TYPE = 'market.tick';
export const MARKET_TICK_SCHEMA_VERSION = 1;

export interface MarketTickPayload {
  readonly provider: MarketTickProvider;
  readonly marketEnv: 'mock' | 'production';
  readonly symbol: string;
  readonly market: MarketTickMarket;
  readonly sourceTs: string | null;
  readonly receivedAt: string;
  readonly price: number | null;
  readonly priceChange: number | null;
  readonly changeRate: number | null;
  readonly tradeVolume: number | null;
  readonly cumulativeVolume: number | null;
  readonly open: number | null;
  readonly high: number | null;
  readonly low: number | null;
  readonly bestBid: number | null;
  readonly bestAsk: number | null;
  readonly parseWarnings: readonly string[];
}

export function marketTickChannel(
  provider: MarketTickProvider,
  marketEnv: 'mock' | 'production',
  symbol: string,
): string {
  return `market.tick.${provider}.${marketEnv}.${symbol}`;
}
