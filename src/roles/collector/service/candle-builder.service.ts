import { Injectable } from '@nestjs/common';
import type { MarketTickPayload } from '@shared/event/market-tick.event';
import { addMinutes, floorToKstMinute, type CandleModel } from './candle.model';
import { TickRejection, type TickRejectionCode } from './tick-rejection';

export type CandleIngestResult =
  | { kind: 'accepted'; closed: CandleModel | null; current: CandleModel }
  | { kind: 'rejected'; reason: TickRejectionCode; detail: string };

// In-memory 1m candle accumulator. Phase 6.6 scope: pure domain object —
// no persistence, no broadcast, no timer flush. Candles close when a
// later-bucket tick arrives (returned `closed` field) or when caller
// invokes flushAll() at shutdown/EOD.
//
// Required tick fields: price, tradeVolume, sourceTs. cumulativeVolume is
// optional; anomalies (cumVol regressions) count toward the candle's
// anomaly counter without rejecting the tick.
@Injectable()
export class CandleBuilderService {
  private readonly current = new Map<string, CandleModel>();

  private readonly lastAcceptedSourceTsMs = new Map<string, number>();

  private readonly rejections = new Map<TickRejectionCode, number>();

  ingest(tick: MarketTickPayload): CandleIngestResult {
    if (
      tick.parseWarnings.includes('missing-price') ||
      tick.parseWarnings.includes('missing-trade-volume') ||
      tick.parseWarnings.includes('missing-source-ts')
    ) {
      return this.reject(
        TickRejection.ParseWarning,
        `blocking parseWarnings: ${tick.parseWarnings.join(',')}`,
      );
    }

    const sourceTs = tick.sourceTs ? new Date(tick.sourceTs) : null;

    if (tick.price === null || tick.tradeVolume === null || sourceTs === null) {
      return this.reject(
        TickRejection.MissingRequiredField,
        `price=${tick.price} tradeVolume=${tick.tradeVolume} sourceTs=${tick.sourceTs}`,
      );
    }

    if (tick.price <= 0) {
      return this.reject(TickRejection.InvalidPrice, `price=${tick.price}`);
    }

    if (tick.tradeVolume === 0) {
      return this.reject(TickRejection.InvalidVolume, 'tradeVolume=0');
    }

    const key = `${tick.marketEnv}:${tick.symbol}`;
    const newTsMs = sourceTs.getTime();
    const lastTsMs = this.lastAcceptedSourceTsMs.get(key);

    if (lastTsMs !== undefined && newTsMs < lastTsMs) {
      return this.reject(
        TickRejection.StaleTick,
        `sourceTs=${sourceTs.toISOString()} last=${new Date(lastTsMs).toISOString()}`,
      );
    }

    const bucketStart = floorToKstMinute(sourceTs);
    const existing = this.current.get(key);

    let closed: CandleModel | null = null;
    let nextCurrent: CandleModel;

    if (existing && existing.bucketStart.getTime() === bucketStart.getTime()) {
      nextCurrent = updateCandle(existing, tick, sourceTs);
    } else {
      if (existing) closed = existing;

      nextCurrent = openCandle(tick, sourceTs, bucketStart);
    }

    this.current.set(key, nextCurrent);

    this.lastAcceptedSourceTsMs.set(key, newTsMs);

    return { kind: 'accepted', closed, current: nextCurrent };
  }

  openBuckets(): readonly CandleModel[] {
    return Array.from(this.current.values());
  }

  // Detach and return all currently-open candles, clearing state. Use at
  // SIGTERM / EOD so no bucket vanishes silently.
  flushAll(): CandleModel[] {
    const out = Array.from(this.current.values());

    this.current.clear();

    this.lastAcceptedSourceTsMs.clear();

    return out;
  }

  rejectionCounts(): ReadonlyMap<TickRejectionCode, number> {
    return new Map(this.rejections);
  }

  private reject(reason: TickRejectionCode, detail: string): CandleIngestResult {
    this.rejections.set(reason, (this.rejections.get(reason) ?? 0) + 1);

    return { kind: 'rejected', reason, detail };
  }
}

function openCandle(tick: MarketTickPayload, sourceTs: Date, bucketStart: Date): CandleModel {
  const price = tick.price as number;
  const tradeVolume = tick.tradeVolume as number;

  return {
    symbol: tick.symbol,
    marketEnv: tick.marketEnv,
    market: tick.market,
    chartSource: 'trade_tick_0B',
    chartMarket: 'KRW',
    bucketStart,
    bucketEnd: addMinutes(bucketStart, 1),
    open: price,
    high: price,
    low: price,
    close: price,
    volume: Math.abs(tradeVolume),
    tickCount: 1,
    firstSourceTs: sourceTs,
    lastSourceTs: sourceTs,
    cumulativeVolumeFirst: tick.cumulativeVolume,
    cumulativeVolumeLast: tick.cumulativeVolume,
    cumulativeVolumeAnomalies: 0,
  };
}

function updateCandle(prev: CandleModel, tick: MarketTickPayload, sourceTs: Date): CandleModel {
  const price = tick.price as number;
  const tradeVolume = tick.tradeVolume as number;
  const incomingCumVol = tick.cumulativeVolume;
  const cumVolAnomaly =
    incomingCumVol !== null &&
    prev.cumulativeVolumeLast !== null &&
    incomingCumVol < prev.cumulativeVolumeLast;

  return {
    ...prev,
    high: Math.max(prev.high, price),
    low: Math.min(prev.low, price),
    close: price,
    volume: prev.volume + Math.abs(tradeVolume),
    tickCount: prev.tickCount + 1,
    lastSourceTs: sourceTs,
    cumulativeVolumeLast: incomingCumVol ?? prev.cumulativeVolumeLast,
    cumulativeVolumeAnomalies: prev.cumulativeVolumeAnomalies + (cumVolAnomaly ? 1 : 0),
  };
}
