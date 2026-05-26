import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { ChartCatchupRequest } from './chart-catchup.service';

type EmptyReason = 'transient' | 'holiday' | 'no_data';

const EMPTY_REASON_PRIORITY: Readonly<Record<EmptyReason, number>> = {
  transient: 1,
  no_data: 2,
  holiday: 3,
};

const TRANSIENT_EMPTY_TTL_MS = 10 * 60_000;

@Injectable()
export class ChartEmptyRangeService {
  private readonly logger = new Logger(ChartEmptyRangeService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async recordEmpty(request: ChartCatchupRequest, reason: EmptyReason = 'transient'): Promise<void> {
    await this.recordEmptyRange(
      request,
      request.targetFromIso ?? request.fromIso,
      request.targetToIso ?? request.toIso,
      reason,
    );
  }

  async recordEmptyRange(
    request: ChartCatchupRequest,
    fromIso: string,
    toIso: string,
    reason: EmptyReason = 'transient',
  ): Promise<void> {
    await this.ensureTable();

    const from = new Date(fromIso);
    const to = new Date(toIso);
    const ttlUntil = new Date(Date.now() + this.ttlMsFor(reason));

    try {
      await this.dataSource.query(
        `
          INSERT INTO chart_empty_ranges (
            provider, market_env, symbol, interval_type, chart_market,
            range_from, range_to, reason, recorded_at, ttl_until
          )
          VALUES ('KIWOOM', $1, $2, $3, $4, $5, $6, $7, NOW(), $8)
          ON CONFLICT (provider, market_env, symbol, interval_type, chart_market, range_from, range_to)
          DO UPDATE SET
            reason = CASE
              WHEN $9 > CASE chart_empty_ranges.reason
                WHEN 'holiday' THEN 3
                WHEN 'no_data' THEN 2
                ELSE 1
              END THEN EXCLUDED.reason
              ELSE chart_empty_ranges.reason
            END,
            recorded_at = NOW(),
            ttl_until = GREATEST(chart_empty_ranges.ttl_until, EXCLUDED.ttl_until)
        `,
        [
          request.marketEnv.toUpperCase(),
          request.symbol,
          request.intervalType.toUpperCase(),
          request.chartMarket ?? (request.marketEnv === 'production' ? 'AL' : 'KRW'),
          from,
          to,
          reason,
          ttlUntil,
          EMPTY_REASON_PRIORITY[reason],
        ],
      );
    } catch (err) {
      this.logger.warn(
        `empty range marker failed request=${request.requestId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private ttlMsFor(reason: EmptyReason): number {
    switch (reason) {
      case 'holiday':
        return 24 * 60 * 60_000;
      case 'no_data':
        return 30 * 60_000;
      case 'transient':
      default:
        return TRANSIENT_EMPTY_TTL_MS;
    }
  }

  private async ensureTable(): Promise<void> {
    if (process.env.NODE_ENV === 'production') return;

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS chart_empty_ranges (
        provider varchar(100) NOT NULL,
        market_env varchar(20) NOT NULL,
        symbol varchar(50) NOT NULL,
        interval_type varchar(20) NOT NULL,
        chart_market varchar(16) NOT NULL,
        range_from timestamptz NOT NULL,
        range_to timestamptz NOT NULL,
        reason varchar(16) NOT NULL,
        recorded_at timestamptz NOT NULL DEFAULT NOW(),
        ttl_until timestamptz NOT NULL,
        PRIMARY KEY (provider, market_env, symbol, interval_type, chart_market, range_from, range_to),
        CHECK (range_from < range_to),
        CHECK (reason IN ('transient', 'holiday', 'no_data'))
      )
    `);
    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS ix_chart_empty_ranges_lookup
      ON chart_empty_ranges (provider, market_env, symbol, interval_type, chart_market, range_from, range_to, ttl_until)
    `);
  }
}
