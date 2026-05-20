import { Injectable, Logger, Optional, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { MarketCandleClosedPayload } from '@shared/event/market-candle-closed.event';
import { CandleEntity } from './candle.entity';
import type { CandleRepository } from './candle.repository';

// TypeORM impl. Falls back to a no-op when persistence is disabled (Phase 1
// degraded-boot contract) so collector can still run with DB down — close
// events still flow through Streams for calculator (which has its own
// degraded handling).
@Injectable()
export class CandleRepositoryImpl implements CandleRepository, OnApplicationBootstrap {
  private readonly logger = new Logger(CandleRepositoryImpl.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @Optional()
    @InjectRepository(CandleEntity)
    private readonly repo?: Repository<CandleEntity>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.repo) return;
    if (process.env.NODE_ENV === 'production') {
      this.logger.log('production mode: skipping market_candles bootstrap DDL; use migrations');

      return;
    }
    await this.ensureMarketCandlesTable();
  }

  async upsertClosed(
    payload: MarketCandleClosedPayload,
  ): Promise<'inserted' | 'updated' | 'skipped'> {
    if (!this.repo) {
      this.logger.debug(
        `persistence disabled — candle close write skipped (${payload.symbol}@${payload.bucketStart})`,
      );

      return 'skipped';
    }

    const provider = payload.provider.toUpperCase();
    const marketEnv = payload.marketEnv.toUpperCase();
    const intervalType = payload.intervalType.toUpperCase();
    const rows = (await this.dataSource.query(
      `
        INSERT INTO market_candles (
          provider, market_env, symbol, interval_type, candle_time, bucket_end,
          open, high, low, close, volume, last_source_ts, market, tick_count,
          first_source_ts, cumulative_volume_first, cumulative_volume_last,
          cumulative_volume_anomalies, data_source, chart_source, chart_market, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20, $21, NOW()
        )
        ON CONFLICT (provider, market_env, symbol, interval_type, candle_time, chart_market)
        DO UPDATE SET
          bucket_end = EXCLUDED.bucket_end,
          open = EXCLUDED.open,
          high = EXCLUDED.high,
          low = EXCLUDED.low,
          close = EXCLUDED.close,
          volume = EXCLUDED.volume,
          last_source_ts = EXCLUDED.last_source_ts,
          market = EXCLUDED.market,
          tick_count = EXCLUDED.tick_count,
          first_source_ts = EXCLUDED.first_source_ts,
          cumulative_volume_first = EXCLUDED.cumulative_volume_first,
          cumulative_volume_last = EXCLUDED.cumulative_volume_last,
          cumulative_volume_anomalies = EXCLUDED.cumulative_volume_anomalies,
          data_source = EXCLUDED.data_source,
          chart_source = EXCLUDED.chart_source,
          chart_market = EXCLUDED.chart_market,
          updated_at = NOW()
        WHERE COALESCE(market_candles.data_source, '') <> 'realtime'
           OR EXCLUDED.data_source = 'realtime'
        -- TODO(broker-chart-AL): when AL parser lands, replace same-priority
        -- realtime last-writer-wins with chart_source priority
        -- (broker_chart_AL > trade_tick_0B > unknown).
        RETURNING (xmax = 0) AS inserted
      `,
      [
        provider,
        marketEnv,
        payload.symbol,
        intervalType,
        new Date(payload.bucketStart),
        new Date(payload.bucketEnd),
        payload.open,
        payload.high,
        payload.low,
        payload.close,
        payload.volume,
        new Date(payload.lastSourceTs),
        payload.market,
        payload.tickCount,
        new Date(payload.firstSourceTs),
        payload.cumulativeVolumeFirst,
        payload.cumulativeVolumeLast,
        payload.cumulativeVolumeAnomalies,
        payload.dataSource,
        payload.chartSource,
        payload.chartMarket,
      ],
    )) as Array<{ inserted: boolean }>;

    if (rows.length === 0) return 'skipped';

    return rows[0].inserted ? 'inserted' : 'updated';
  }

  private async ensureMarketCandlesTable(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS market_candles (
        provider varchar(100) NOT NULL,
        market_env varchar(20) NOT NULL,
        symbol varchar(50) NOT NULL,
        interval_type varchar(20) NOT NULL,
        candle_time timestamptz NOT NULL,
        bucket_end timestamptz NOT NULL,
        open numeric(18, 4) NOT NULL,
        high numeric(18, 4) NOT NULL,
        low numeric(18, 4) NOT NULL,
        close numeric(18, 4) NOT NULL,
        volume numeric(24, 4) NOT NULL,
        chart_market varchar(16) NOT NULL DEFAULT 'KRW',
        last_source_ts timestamptz NULL,
        PRIMARY KEY (provider, market_env, symbol, interval_type, candle_time, chart_market)
      )
    `);
    await this.dataSource.query(`
      ALTER TABLE market_candles ADD COLUMN IF NOT EXISTS market text NULL
    `);
    await this.dataSource.query(`
      ALTER TABLE market_candles ADD COLUMN IF NOT EXISTS stock_id bigint NULL
    `);
    await this.dataSource.query(`
      ALTER TABLE market_candles ADD COLUMN IF NOT EXISTS tick_count integer NOT NULL DEFAULT 0
    `);
    await this.dataSource.query(`
      ALTER TABLE market_candles ADD COLUMN IF NOT EXISTS first_source_ts timestamptz NULL
    `);
    await this.dataSource.query(`
      ALTER TABLE market_candles ADD COLUMN IF NOT EXISTS cumulative_volume_first double precision NULL
    `);
    await this.dataSource.query(`
      ALTER TABLE market_candles ADD COLUMN IF NOT EXISTS cumulative_volume_last double precision NULL
    `);
    await this.dataSource.query(`
      ALTER TABLE market_candles ADD COLUMN IF NOT EXISTS cumulative_volume_anomalies integer NOT NULL DEFAULT 0
    `);
    await this.dataSource.query(`
      ALTER TABLE market_candles ADD COLUMN IF NOT EXISTS data_source varchar(16) NULL
    `);
    await this.dataSource.query(`
      ALTER TABLE market_candles ADD COLUMN IF NOT EXISTS chart_source varchar(32) NOT NULL DEFAULT 'unknown'
    `);
    await this.dataSource.query(`
      ALTER TABLE market_candles ADD COLUMN IF NOT EXISTS chart_market varchar(16) NOT NULL DEFAULT 'UNKNOWN'
    `);
    await this.dataSource.query(`
      UPDATE market_candles
      SET chart_market = 'KRW'
      WHERE chart_market IS NULL OR chart_market = 'UNKNOWN'
    `);
    await this.dataSource.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'market_candles'::regclass
            AND conname = 'market_candles_pkey'
        ) THEN
          ALTER TABLE market_candles DROP CONSTRAINT market_candles_pkey;
        END IF;
      END $$;
    `);
    await this.dataSource.query(`
      ALTER TABLE market_candles
      ADD CONSTRAINT market_candles_pkey
      PRIMARY KEY (provider, market_env, symbol, interval_type, candle_time, chart_market)
    `);
    await this.dataSource.query(`
      ALTER TABLE market_candles ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT NOW()
    `);
    await this.dataSource.query(`
      ALTER TABLE market_candles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW()
    `);
    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS ix_market_candles_query
      ON market_candles (provider, market_env, symbol, interval_type, chart_market, candle_time)
    `);
  }
}
