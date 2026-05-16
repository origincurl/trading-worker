// Wire format for live orderbook fan-out via Redis Pub/Sub.
// architecture.md §8: BE WS gateway subscribes to
// `market.orderbook.{provider}.{marketEnv}.{symbol}` and routes to FE.
//
// Phase 6.5: Kiwoom REAL `0D` frames (호가) parsed to 10-level snapshot.

import type { MarketTickMarket, MarketTickProvider } from './market-tick.event';

export const MARKET_ORDERBOOK_EVENT_TYPE = 'market.orderbook';
export const MARKET_ORDERBOOK_SCHEMA_VERSION = 1;

export interface OrderbookLevel {
  readonly rank: number;
  readonly bid: { price: number; size: number } | null;
  readonly ask: { price: number; size: number } | null;
}

export interface MarketOrderbookPayload {
  readonly provider: MarketTickProvider;
  readonly marketEnv: 'mock' | 'production';
  readonly symbol: string;
  readonly market: MarketTickMarket;
  readonly sourceTs: string | null;
  readonly receivedAt: string;
  readonly bestBid: { price: number; size: number } | null;
  readonly bestAsk: { price: number; size: number } | null;
  readonly spread: number | null;
  readonly spreadBps: number | null;
  readonly totalBidSize: number | null;
  readonly totalAskSize: number | null;
  readonly levels: readonly OrderbookLevel[];
}

export function marketOrderbookChannel(
  provider: MarketTickProvider,
  marketEnv: 'mock' | 'production',
  symbol: string,
): string {
  return `market.orderbook.${provider}.${marketEnv}.${symbol}`;
}
