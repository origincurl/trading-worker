import { parseSignedNumber } from '@common/util/kiwoom-number-parse';
import { parseHhmmssToDate } from '@common/util/kiwoom-time-parse';
import type { MarketOrderbookPayload, OrderbookLevel } from '@shared/event/market-orderbook.event';
import type { DispatchContext, DispatchResult } from './kiwoom-tick.event-mapper';

// Kiwoom REAL `0D` FID dictionary (verified against captured frames).
// 10 levels each side. Time field on 0D is FID 21.
const ORDERBOOK_FID = {
  TIME: '21',
  ASK_PRICES: ['41', '42', '43', '44', '45', '46', '47', '48', '49', '50'],
  BID_PRICES: ['51', '52', '53', '54', '55', '56', '57', '58', '59', '60'],
  ASK_SIZES: ['61', '62', '63', '64', '65', '66', '67', '68', '69', '70'],
  BID_SIZES: ['71', '72', '73', '74', '75', '76', '77', '78', '79', '80'],
  TOTAL_ASK_SIZE: '121',
  TOTAL_BID_SIZE: '125',
} as const;

interface KiwoomRealEntry {
  readonly type?: unknown;
  readonly item?: unknown;
  readonly values?: unknown;
}

export type OrderbookDispatchResult =
  | { kind: 'orderbook'; orderbook: MarketOrderbookPayload }
  | { kind: 'dead-letter'; realtimeType: string | null; symbol: string | null; reason: string };

export function parseOrderbook0D(
  entry: KiwoomRealEntry,
  ctx: DispatchContext,
): OrderbookDispatchResult {
  const symbol = typeof entry.item === 'string' && entry.item.length > 0 ? entry.item : null;

  if (symbol === null) {
    return {
      kind: 'dead-letter',
      realtimeType: '0D',
      symbol: null,
      reason: 'missing or non-string item (symbol)',
    };
  }

  if (!isStringRecord(entry.values)) {
    return {
      kind: 'dead-letter',
      realtimeType: '0D',
      symbol,
      reason: 'values not a string record',
    };
  }

  const values = entry.values;
  const sourceTs = parseHhmmssToDate(values[ORDERBOOK_FID.TIME], ctx.receivedAt);

  const levels: OrderbookLevel[] = ORDERBOOK_FID.ASK_PRICES.map((askFid, index) => {
    const bidPrice = parsePrice(values[ORDERBOOK_FID.BID_PRICES[index]]);
    const askPrice = parsePrice(values[askFid]);
    const bidSize = parseUnsigned(values[ORDERBOOK_FID.BID_SIZES[index]]);
    const askSize = parseUnsigned(values[ORDERBOOK_FID.ASK_SIZES[index]]);

    return {
      rank: index + 1,
      bid: bidPrice === null || bidSize === null ? null : { price: bidPrice, size: bidSize },
      ask: askPrice === null || askSize === null ? null : { price: askPrice, size: askSize },
    };
  });

  const bestBid = levels[0]?.bid ?? null;
  const bestAsk = levels[0]?.ask ?? null;
  const spread = bestBid && bestAsk ? Math.max(0, bestAsk.price - bestBid.price) : null;
  const mid = bestBid && bestAsk ? (bestAsk.price + bestBid.price) / 2 : null;
  const spreadBps = spread !== null && mid !== null && mid > 0 ? (spread / mid) * 10_000 : null;

  return {
    kind: 'orderbook',
    orderbook: {
      provider: 'kiwoom',
      marketEnv: ctx.marketEnv,
      symbol,
      market: null,
      sourceTs: sourceTs?.toISOString() ?? null,
      receivedAt: ctx.receivedAt.toISOString(),
      bestBid,
      bestAsk,
      spread,
      spreadBps,
      totalBidSize: parseUnsigned(values[ORDERBOOK_FID.TOTAL_BID_SIZE]),
      totalAskSize: parseUnsigned(values[ORDERBOOK_FID.TOTAL_ASK_SIZE]),
      levels,
    },
  };
}

// Bridge helper for the unified dispatcher in kiwoom-tick.event-mapper.ts.
// Returns the same shape as DispatchResult so the dispatcher can collapse
// 0B + 0D + dead-letter into one union without circular imports.
export function orderbookToDispatchResult(result: OrderbookDispatchResult): DispatchResult {
  if (result.kind === 'orderbook') {
    return { kind: 'orderbook', orderbook: result.orderbook } as DispatchResult;
  }

  return result;
}

function parsePrice(value: unknown): number | null {
  const n = parseSignedNumber(value);

  return n === null ? null : Math.abs(n);
}

function parseUnsigned(value: unknown): number | null {
  const n = parseSignedNumber(value);

  return n === null ? null : Math.abs(n);
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
