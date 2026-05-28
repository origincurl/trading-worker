import { parseSignedNumber } from '@common/util/kiwoom-number-parse';
import { parseHhmmssToDate } from '@common/util/kiwoom-time-parse';
import type { OrderFilledPayload } from '@shared/event/order-filled.event';

// Kiwoom execution-stream frame → OrderFilledPayload.
//
// The realtime type for execution frames (`00` per typical Kiwoom WS) and
// the exact FID layout differ from market-data frames. Phase 8 defines the
// mapper surface; the parsed FIDs reflect the publicly-documented shape but
// are subject to refinement against captured production frames. Unknown
// fields collapse to dead-letter rather than silently dropping.

interface KiwoomExecutionEntry {
  readonly type?: unknown;
  readonly item?: unknown;
  readonly values?: unknown;
}

export type ExecutionDispatchResult =
  | { kind: 'fill'; payload: OrderFilledPayload }
  | { kind: 'ignored'; reason: string }
  | { kind: 'dead-letter'; realtimeType: string | null; reason: string };

// Field IDs commonly seen on `00` execution frames. Worker-side mapping
// will be validated against capture once a real production run is
// available; for now the parser is conservative — it returns dead-letter
// on any unmappable frame.
const FID = {
  ACCOUNT: '9201',
  ORDER_NO: '9203',
  ORDER_STATUS: '913',
  FILL_NO: '909',
  SYMBOL: '9001',
  SIDE_TEXT: '905',
  SIDE_CODE: '907',
  EXECUTED_TIME: '908',
  EXECUTED_PRICE: '910',
  EXECUTED_QTY: '911',
  UNIT_EXECUTED_PRICE: '914',
  UNIT_EXECUTED_QTY: '915',
} as const;

export interface ExecutionDispatchContext {
  readonly marketEnv: 'mock' | 'production';
  readonly receivedAt: Date;
}

export function dispatchExecutionFrame(
  frame: unknown,
  ctx: ExecutionDispatchContext,
): ExecutionDispatchResult[] {
  if (!isPlainObject(frame)) {
    return [{ kind: 'dead-letter', realtimeType: null, reason: 'frame not object' }];
  }

  if (frame['trnm'] !== 'REAL') {
    return [{ kind: 'ignored', reason: typeof frame['trnm'] === 'string' ? frame['trnm'] : '?' }];
  }

  const data = frame['data'];

  if (!Array.isArray(data)) {
    return [{ kind: 'dead-letter', realtimeType: null, reason: 'missing data array' }];
  }

  const out: ExecutionDispatchResult[] = [];

  for (const entry of data) {
    if (!isPlainObject(entry)) {
      out.push({ kind: 'dead-letter', realtimeType: null, reason: 'entry not object' });

      continue;
    }

    out.push(parseExecution(entry as KiwoomExecutionEntry, ctx));
  }

  return out;
}

function parseExecution(
  entry: KiwoomExecutionEntry,
  ctx: ExecutionDispatchContext,
): ExecutionDispatchResult {
  const realtimeType = typeof entry.type === 'string' ? entry.type : null;

  if (realtimeType !== '00') {
    return {
      kind: 'dead-letter',
      realtimeType,
      reason: realtimeType ? `unsupported execution type ${realtimeType}` : 'missing type',
    };
  }

  if (!isStringRecord(entry.values)) {
    return { kind: 'dead-letter', realtimeType, reason: 'values not a string record' };
  }

  const values = entry.values;
  const vendorOrderId = strField(values[FID.ORDER_NO]);
  const accountId = strField(values[FID.ACCOUNT]);
  const symbol =
    normalizeKiwoomSymbol(strField(values[FID.SYMBOL])) ??
    (typeof entry.item === 'string' ? normalizeKiwoomSymbol(entry.item) : null);
  const status = strField(values[FID.ORDER_STATUS]);
  const sideRaw = strField(values[FID.SIDE_CODE]) ?? strField(values[FID.SIDE_TEXT]);
  const filledQty =
    parseSignedNumber(values[FID.UNIT_EXECUTED_QTY]) ??
    parseSignedNumber(values[FID.EXECUTED_QTY]);
  const filledPrice =
    parseSignedNumber(values[FID.UNIT_EXECUTED_PRICE]) ??
    parseSignedNumber(values[FID.EXECUTED_PRICE]);
  const filledAt = parseHhmmssToDate(values[FID.EXECUTED_TIME], ctx.receivedAt);
  const fillNo = strField(values[FID.FILL_NO]);

  if (status && !status.includes('체결')) {
    return { kind: 'ignored', reason: `execution status ${status}` };
  }

  if (filledQty !== null && Math.abs(filledQty) === 0) {
    return { kind: 'ignored', reason: 'zero fill quantity' };
  }

  if (!vendorOrderId || !accountId || !symbol || filledQty === null || filledPrice === null) {
    return {
      kind: 'dead-letter',
      realtimeType,
      reason: `incomplete execution frame vendorOrderId=${vendorOrderId} qty=${filledQty} price=${filledPrice}`,
    };
  }

  const side = mapSide(sideRaw);

  if (!side) {
    return { kind: 'dead-letter', realtimeType, reason: `unknown side ${sideRaw}` };
  }

  return {
    kind: 'fill',
    payload: {
      provider: 'kiwoom',
      marketEnv: ctx.marketEnv,
      accountId,
      clientOrderId: '',
      vendorOrderId,
      externalFillId: [
        'kiwoom',
        ctx.marketEnv,
        accountId,
        vendorOrderId,
        fillNo ?? 'no-fill-no',
        (filledAt ?? ctx.receivedAt).toISOString(),
        Math.abs(filledQty),
        Math.abs(filledPrice),
      ].join(':'),
      symbol,
      side,
      filledQty: Math.abs(filledQty),
      filledPrice: Math.abs(filledPrice),
      filledAt: (filledAt ?? ctx.receivedAt).toISOString(),
    },
  };
}

function strField(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  return trimmed.length === 0 ? null : trimmed;
}

function mapSide(raw: string | null): 'buy' | 'sell' | null {
  if (!raw) return null;

  if (raw === '2' || raw.toLowerCase() === 'buy') return 'buy';

  if (raw === '1' || raw.toLowerCase() === 'sell') return 'sell';

  if (raw.includes('매수')) return 'buy';

  if (raw.includes('매도')) return 'sell';

  return null;
}

function normalizeKiwoomSymbol(value: string | null): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  const withoutPrefix = trimmed.startsWith('A') ? trimmed.slice(1) : trimmed;

  return withoutPrefix.length > 0 ? withoutPrefix : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
