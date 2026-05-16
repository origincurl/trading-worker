import type { MarketTickMarket } from '@shared/event/market-tick.event';

// In-memory 1m candle aggregate. Phase 6.6 uses Date for internal math;
// model→event conversion stringifies on the boundary.
//
// bucketStart is the start of the KST minute the candle covers, stored as
// a UTC instant. bucketEnd = bucketStart + 60s. KST conversion lives in
// floorToKstMinute() so host TZ does not affect alignment.

export interface CandleModel {
  symbol: string;
  marketEnv: 'mock' | 'production';
  market: MarketTickMarket;
  bucketStart: Date;
  bucketEnd: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickCount: number;
  firstSourceTs: Date;
  lastSourceTs: Date;
  cumulativeVolumeFirst: number | null;
  cumulativeVolumeLast: number | null;
  cumulativeVolumeAnomalies: number;
}

const KST_OFFSET_MIN = 9 * 60;
const ONE_MINUTE_MS = 60_000;

export function floorToKstMinute(d: Date): Date {
  const utcMs = d.getTime();

  if (!Number.isFinite(utcMs)) throw new Error('floorToKstMinute: invalid Date');

  const kstMs = utcMs + KST_OFFSET_MIN * ONE_MINUTE_MS;
  const flooredKst = kstMs - (kstMs % ONE_MINUTE_MS);

  return new Date(flooredKst - KST_OFFSET_MIN * ONE_MINUTE_MS);
}

export function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * ONE_MINUTE_MS);
}
