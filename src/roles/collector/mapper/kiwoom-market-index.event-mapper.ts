import { parseSignedNumber } from '@common/util/kiwoom-number-parse';
import { parseHhmmssToDate } from '@common/util/kiwoom-time-parse';
import type { KiwoomMarketEnv } from '@config/kiwoom.config';
import {
  MARKET_INDEX_NAMES,
  MARKET_INDEX_SYMBOL_BY_CODE,
  type MarketIndexPayload,
} from '@shared/event/market-index.event';

interface KiwoomRealEntry {
  readonly type?: unknown;
  readonly item?: unknown;
  readonly values?: unknown;
}

export type MarketIndexDispatchResult =
  | { kind: 'market-index'; marketIndex: MarketIndexPayload }
  | { kind: 'dead-letter'; realtimeType: '0J'; symbol: string | null; reason: string };

export interface MarketIndexDispatchContext {
  readonly marketEnv: KiwoomMarketEnv;
  readonly receivedAt: Date;
}

const FID = {
  TIME: '20',
  VALUE: '10',
  CHANGE: '11',
  CHANGE_RATE: '12',
  VOLUME: '13',
  TRADE_VALUE: '14',
} as const;

export function parseMarketIndex0J(
  entry: KiwoomRealEntry,
  ctx: MarketIndexDispatchContext,
): MarketIndexDispatchResult {
  const item = typeof entry.item === 'string' && entry.item.length > 0 ? entry.item : null;

  if (item === null) {
    return {
      kind: 'dead-letter',
      realtimeType: '0J',
      symbol: null,
      reason: 'missing or non-string item (index code)',
    };
  }

  const symbol = MARKET_INDEX_SYMBOL_BY_CODE[item];

  if (!symbol) {
    return {
      kind: 'dead-letter',
      realtimeType: '0J',
      symbol: item,
      reason: `unsupported market index code ${item}`,
    };
  }

  if (!isRecord(entry.values)) {
    return {
      kind: 'dead-letter',
      realtimeType: '0J',
      symbol: item,
      reason: 'values not a record',
    };
  }

  const values = entry.values;
  const sourceTs = parseHhmmssToDate(values[FID.TIME], ctx.receivedAt);

  return {
    kind: 'market-index',
    marketIndex: {
      provider: 'KIWOOM',
      marketEnv: ctx.marketEnv === 'production' ? 'PRODUCTION' : 'MOCK',
      symbol,
      name: MARKET_INDEX_NAMES[symbol],
      lastUpdatedAt: sourceTs?.toISOString() ?? ctx.receivedAt.toISOString(),
      value: parseIndexValue(values[FID.VALUE]),
      change: parseSignedNumber(values[FID.CHANGE]),
      changePct: parseSignedNumber(values[FID.CHANGE_RATE]),
      volume: parseAbs(values[FID.VOLUME]),
      tradeValue: parseAbs(values[FID.TRADE_VALUE]),
    },
  };
}

function parseIndexValue(value: unknown): number | null {
  const n = parseSignedNumber(value);

  // Index levels are unsigned display values even when Kiwoom sends signed
  // numeric strings in realtime frames.
  return n === null ? null : Math.abs(n);
}

function parseAbs(value: unknown): number | null {
  const n = parseSignedNumber(value);

  return n === null ? null : Math.abs(n);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
