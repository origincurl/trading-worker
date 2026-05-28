import { Inject, Injectable, Logger } from '@nestjs/common';
import { BUS_PUBLISHER, BUS_STREAMS } from '@shared/bus/bus.token';
import type { BusPublisher } from '@shared/bus/bus-publisher.interface';
import type { BusStreams } from '@shared/bus/bus-streams.interface';
import { WorkerEventFactory } from '@shared/event/event-factory';
import {
  MARKET_CANDLE_CLOSED_EVENT_TYPE,
  MARKET_CANDLE_CLOSED_SCHEMA_VERSION,
  MARKET_CANDLE_CLOSED_STREAM,
  marketCandleClosedChannel,
  type MarketCandleClosedPayload,
} from '@shared/event/market-candle-closed.event';
import { CANDLE_REPOSITORY, type CandleRepository } from '../repository/candle.repository';
import type { CandleModel } from './candle.model';
import { isKrxContinuousSessionBucket } from '@shared/chart-archive/partition-key';

// One closed candle → upsert in DB + produce on Redis Streams.
// architecture.md §8: closed candles are durable (Streams), realtime ticks
// are volatile (pubsub). calculator (Phase 7) is the canonical consumer.
@Injectable()
export class CandleCloseService {
  private readonly logger = new Logger(CandleCloseService.name);

  private _closedCount = 0;

  private _lastClosedAt: Date | null = null;

  constructor(
    @Inject(CANDLE_REPOSITORY) private readonly repo: CandleRepository,
    @Inject(BUS_PUBLISHER) private readonly publisher: BusPublisher,
    @Inject(BUS_STREAMS) private readonly streams: BusStreams,
    private readonly eventFactory: WorkerEventFactory,
  ) {}

  closedCount(): number {
    return this._closedCount;
  }

  lastClosedAt(): Date | null {
    return this._lastClosedAt;
  }

  async close(candle: CandleModel, dataSource: 'realtime' | 'catchup'): Promise<void> {
    if (!isKrxContinuousSessionBucket(candle.bucketStart)) {
      this.logger.debug(
        `skip non-continuous KRX candle (${candle.symbol}@${candle.bucketStart.toISOString()})`,
      );
      return;
    }

    const payload: MarketCandleClosedPayload = {
      provider: 'kiwoom',
      marketEnv: candle.marketEnv,
      symbol: candle.symbol,
      market: candle.market,
      chartSource: candle.chartSource,
      chartMarket: candle.chartMarket,
      intervalType: '1m',
      bucketStart: candle.bucketStart.toISOString(),
      bucketEnd: candle.bucketEnd.toISOString(),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      tickCount: candle.tickCount,
      firstSourceTs: candle.firstSourceTs.toISOString(),
      lastSourceTs: candle.lastSourceTs.toISOString(),
      cumulativeVolumeFirst: candle.cumulativeVolumeFirst,
      cumulativeVolumeLast: candle.cumulativeVolumeLast,
      cumulativeVolumeAnomalies: candle.cumulativeVolumeAnomalies,
      dataSource,
    };

    // Repo first so a DB outage is loud (rather than emitting a closed
    // event nobody can persist), but Streams is fire-and-forget on
    // failure — calculator can replay via DB if it lags.
    const event = this.eventFactory.build({
      eventType: MARKET_CANDLE_CLOSED_EVENT_TYPE,
      schemaVersion: MARKET_CANDLE_CLOSED_SCHEMA_VERSION,
      role: 'collector',
      payload,
    });

    try {
      await this.repo.upsertClosed(payload);
      await this.publisher.publish(
        marketCandleClosedChannel(
          payload.provider,
          payload.marketEnv,
          payload.symbol,
          payload.intervalType,
        ),
        event,
      );
    } catch (err) {
      this.logger.warn(
        `candle upsert/pubsub failed (${candle.symbol}@${candle.bucketStart.toISOString()}): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    try {
      await this.streams.produce(MARKET_CANDLE_CLOSED_STREAM, event);
    } catch (err) {
      this.logger.warn(
        `candle stream produce failed (${candle.symbol}@${candle.bucketStart.toISOString()}): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    this._closedCount += 1;

    this._lastClosedAt = new Date();
  }
}
