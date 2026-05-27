import { parseSignedNumber } from '@common/util/kiwoom-number-parse';
import { parseHhmmssToDate } from '@common/util/kiwoom-time-parse';
import type { KiwoomMarketEnv } from '@config/kiwoom.config';
import type { MarketIndexPayload } from '@shared/event/market-index.event';
import {
  DASHBOARD_MARKET_KIWOOM_CODES,
  DASHBOARD_MARKET_NAMES,
  type DashboardMarketBreadthPayload,
  type DashboardMarketCode,
} from '@shared/event/market-dashboard.event';
import type { MarketOrderbookPayload } from '@shared/event/market-orderbook.event';
import type { MarketTickPayload } from '@shared/event/market-tick.event';
import { parseMarketIndex0J } from './kiwoom-market-index.event-mapper';
import { parseOrderbook0D } from './kiwoom-orderbook.event-mapper';

// Single entry inside a Kiwoom REAL frame's `data` array. FID dictionary
// for type=0B is documented in the parser. Unknown FIDs are tolerated.
interface KiwoomRealEntry {
  readonly type?: unknown;
  readonly item?: unknown;
  readonly values?: unknown;
}

export type TickParseWarning =
  | 'missing-price'
  | 'missing-trade-volume'
  | 'missing-cumulative-volume'
  | 'missing-source-ts';

export type DispatchResult =
  | { kind: 'tick'; tick: MarketTickPayload }
  | { kind: 'orderbook'; orderbook: MarketOrderbookPayload }
  | { kind: 'market-index'; marketIndex: MarketIndexPayload }
  | { kind: 'market-breadth'; marketBreadth: DashboardMarketBreadthPayload }
  | { kind: 'ignored'; reason: string }
  | { kind: 'dead-letter'; realtimeType: string | null; symbol: string | null; reason: string };

export interface DispatchContext {
  readonly marketEnv: KiwoomMarketEnv;
  readonly receivedAt: Date;
}

const FID = {
  TIME: '20',
  PRICE: '10',
  PRICE_CHANGE: '11',
  CHANGE_RATE: '12',
  CUMULATIVE_VOLUME: '13',
  TRADE_VOLUME: '15',
  OPEN: '16',
  HIGH: '17',
  LOW: '18',
  BEST_ASK: '27',
  BEST_BID: '28',
} as const;

// Dispatch a single Kiwoom WS frame. REAL frames yield one DispatchResult
// per data entry; control frames (LOGIN/REG/REMOVE/PING) collapse to a
// single `ignored` result. Phase 6 only typed kind is `tick` (0B). 0D
// (orderbook) lands as dead-letter here and is reclaimed in Phase 6.5.
export function dispatchKiwoomFrame(frame: unknown, ctx: DispatchContext): DispatchResult[] {
  if (!isPlainObject(frame)) {
    return [{ kind: 'dead-letter', realtimeType: null, symbol: null, reason: 'frame not object' }];
  }

  const trnm = frame['trnm'];

  if (trnm !== 'REAL') {
    return [{ kind: 'ignored', reason: typeof trnm === 'string' ? trnm : 'unknown-trnm' }];
  }

  const data = frame['data'];

  if (!Array.isArray(data)) {
    return [
      {
        kind: 'dead-letter',
        realtimeType: null,
        symbol: null,
        reason: 'REAL frame missing data array',
      },
    ];
  }

  const out: DispatchResult[] = [];

  for (const entry of data) {
    if (!isPlainObject(entry)) {
      out.push({
        kind: 'dead-letter',
        realtimeType: null,
        symbol: null,
        reason: 'REAL data entry not object',
      });

      continue;
    }

    out.push(dispatchEntry(entry as KiwoomRealEntry, ctx));
  }

  return out;
}

function dispatchEntry(entry: KiwoomRealEntry, ctx: DispatchContext): DispatchResult {
  const realtimeType = typeof entry.type === 'string' ? entry.type : null;
  const symbol = typeof entry.item === 'string' && entry.item.length > 0 ? entry.item : null;

  switch (realtimeType) {
    case '0B':
      return parseTradeTick0B(entry, ctx);

    case '0D': {
      const result = parseOrderbook0D(entry, ctx);

      return result.kind === 'orderbook'
        ? { kind: 'orderbook', orderbook: result.orderbook }
        : result;
    }

    case '0J': {
      const result = parseMarketIndex0J(entry, ctx);

      return result.kind === 'market-index'
        ? { kind: 'market-index', marketIndex: result.marketIndex }
        : result;
    }

    case '0U':
      return parseMarketBreadth0U(entry, ctx);

    default:
      return {
        kind: 'dead-letter',
        realtimeType,
        symbol,
        reason:
          realtimeType === null
            ? 'REAL data entry missing type'
            : `unsupported realtime type ${realtimeType}`,
      };
  }
}


function parseMarketBreadth0U(entry: KiwoomRealEntry, ctx: DispatchContext): DispatchResult {
  const item = typeof entry.item === 'string' && entry.item.length > 0 ? entry.item : null;
  const marketCode = marketCodeFromKiwoomItem(item);

  if (!item || !marketCode) {
    return {
      kind: 'dead-letter',
      realtimeType: '0U',
      symbol: item,
      reason: 'unsupported or missing market breadth item',
    };
  }

  if (!isStringRecord(entry.values)) {
    return {
      kind: 'dead-letter',
      realtimeType: '0U',
      symbol: item,
      reason: 'values not a string record',
    };
  }

  const values = entry.values;
  const risingCount = parsePositiveInt(values['252']);
  const upperLimitCount = parsePositiveInt(values['251']);
  const flatCount = parsePositiveInt(values['253']);
  const fallingCount = parsePositiveInt(values['255']);
  const lowerLimitCount = parsePositiveInt(values['254']);
  const tradedCount = parsePositiveInt(values['256']);
  const tradedRatio = parseNumberOrZero(values['257']);

  return {
    kind: 'market-breadth',
    marketBreadth: {
      provider: 'KIWOOM',
      marketEnv: ctx.marketEnv === 'production' ? 'PRODUCTION' : 'MOCK',
      market: DASHBOARD_MARKET_NAMES[marketCode],
      marketCode,
      risingCount,
      upperLimitCount,
      flatCount,
      fallingCount,
      lowerLimitCount,
      tradedCount,
      tradedRatio,
      advanceDeclineRatio: risingCount / Math.max(fallingCount, 1),
      source: '0U',
      updatedAt: ctx.receivedAt.toISOString(),
    },
  };
}

function marketCodeFromKiwoomItem(item: string | null): DashboardMarketCode | null {
  if (!item) return null;

  for (const [marketCode, kiwoomCode] of Object.entries(DASHBOARD_MARKET_KIWOOM_CODES)) {
    if (item === kiwoomCode) return marketCode as DashboardMarketCode;
  }

  return null;
}

function parsePositiveInt(value: unknown): number {
  const n = parseSignedNumber(value);

  return n === null || !Number.isFinite(n) ? 0 : Math.max(0, Math.round(Math.abs(n)));
}

function parseNumberOrZero(value: unknown): number {
  const n = parseSignedNumber(value);

  return n === null || !Number.isFinite(n) ? 0 : n;
}

export function parseTradeTick0B(entry: KiwoomRealEntry, ctx: DispatchContext): DispatchResult {
  const symbol = typeof entry.item === 'string' && entry.item.length > 0 ? entry.item : null;

  if (symbol === null) {
    return {
      kind: 'dead-letter',
      realtimeType: '0B',
      symbol: null,
      reason: 'missing or non-string item (symbol)',
    };
  }

  if (!isStringRecord(entry.values)) {
    return {
      kind: 'dead-letter',
      realtimeType: '0B',
      symbol,
      reason: 'values not a string record',
    };
  }

  const values = entry.values;
  const sourceTs = parseHhmmssToDate(values[FID.TIME], ctx.receivedAt);
  const price = parsePrice(values[FID.PRICE]);
  const tradeVolume = parseSignedNumber(values[FID.TRADE_VOLUME]);
  const cumulativeVolume = parseSignedNumber(values[FID.CUMULATIVE_VOLUME]);

  const parseWarnings: TickParseWarning[] = [];

  if (price === null) parseWarnings.push('missing-price');

  if (tradeVolume === null) parseWarnings.push('missing-trade-volume');

  if (cumulativeVolume === null) parseWarnings.push('missing-cumulative-volume');

  if (sourceTs === null) parseWarnings.push('missing-source-ts');

  const tick: MarketTickPayload = {
    provider: 'kiwoom',
    marketEnv: ctx.marketEnv,
    symbol,
    market: null,
    sourceTs: sourceTs?.toISOString() ?? null,
    receivedAt: ctx.receivedAt.toISOString(),
    price,
    priceChange: parseSignedNumber(values[FID.PRICE_CHANGE]),
    changeRate: parseSignedNumber(values[FID.CHANGE_RATE]),
    tradeVolume,
    cumulativeVolume,
    open: parsePrice(values[FID.OPEN]),
    high: parsePrice(values[FID.HIGH]),
    low: parsePrice(values[FID.LOW]),
    bestBid: parsePrice(values[FID.BEST_BID]),
    bestAsk: parsePrice(values[FID.BEST_ASK]),
    parseWarnings,
  };

  return { kind: 'tick', tick };
}

// Kiwoom price-field decoder. The sign on price FIDs encodes
// previous-close direction, NOT the price's own sign — the absolute
// magnitude is the price. Naively parsing `"-260000"` as `-260000` would
// trip the candle-builder's `price <= 0` gate on ~98% of mock frames.
function parsePrice(value: unknown): number | null {
  const n = parseSignedNumber(value);

  return n === null ? null : Math.abs(n);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
