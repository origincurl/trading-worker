import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { MarketCandleClosedPayload } from '@shared/event/market-candle-closed.event';
import { CandleEntity } from './candle.entity';
import type { CandleRepository } from './candle.repository';

// TypeORM impl. Falls back to a no-op when persistence is disabled (Phase 1
// degraded-boot contract) so collector can still run with DB down — close
// events still flow through Streams for calculator (which has its own
// degraded handling).
@Injectable()
export class CandleRepositoryImpl implements CandleRepository {
  private readonly logger = new Logger(CandleRepositoryImpl.name);

  constructor(
    @Optional()
    @InjectRepository(CandleEntity)
    private readonly repo?: Repository<CandleEntity>,
  ) {}

  async upsertClosed(
    payload: MarketCandleClosedPayload,
  ): Promise<'inserted' | 'updated' | 'skipped'> {
    if (!this.repo) {
      this.logger.debug(
        `persistence disabled — candle close write skipped (${payload.symbol}@${payload.bucketStart})`,
      );

      return 'skipped';
    }

    const existing = await this.repo.findOne({
      where: {
        provider: payload.provider,
        marketEnv: payload.marketEnv,
        symbol: payload.symbol,
        bucketStart: new Date(payload.bucketStart),
      },
    });

    // Realtime > backfill. If a realtime row already sits at this bucket,
    // never let a later backfill overwrite it (chart REST has lower
    // fidelity than tick-level aggregation).
    if (existing && existing.dataSource === 'realtime' && payload.dataSource === 'backfill') {
      return 'skipped';
    }

    const entity = this.repo.create({
      ...(existing ?? {}),
      provider: payload.provider,
      marketEnv: payload.marketEnv,
      symbol: payload.symbol,
      market: payload.market,
      intervalType: payload.intervalType,
      bucketStart: new Date(payload.bucketStart),
      bucketEnd: new Date(payload.bucketEnd),
      open: payload.open,
      high: payload.high,
      low: payload.low,
      close: payload.close,
      volume: payload.volume,
      tickCount: payload.tickCount,
      firstSourceTs: new Date(payload.firstSourceTs),
      lastSourceTs: new Date(payload.lastSourceTs),
      cumVolFirst: payload.cumulativeVolumeFirst,
      cumVolLast: payload.cumulativeVolumeLast,
      cumVolAnomalies: payload.cumulativeVolumeAnomalies,
      dataSource: payload.dataSource,
    });

    await this.repo.save(entity);

    return existing ? 'updated' : 'inserted';
  }
}
