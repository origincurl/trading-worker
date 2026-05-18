import { Inject, Injectable, Logger } from '@nestjs/common';
import { COLLECTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type { BrokerageVendor } from '@external/brokerage/vendor/brokerage.vendor';
import {
  CANDLE_REPOSITORY,
  type CandleRepository,
} from '@roles/collector/repository/candle.repository';
import type { MarketCandleClosedPayload } from '@shared/event/market-candle-closed.event';

// Phase E: actual catchup execution body — vendor fetch + candle upsert.
// Consolidates what used to live in process-chart-catchup-lease.usecase.
// Caller (ProcessChartCatchupUsecase) wraps this with payload validation
// and reporting back to redis.
export interface ChartCatchupRequest {
  readonly requestId: string;
  readonly marketEnv: 'mock' | 'production';
  readonly symbol: string;
  readonly intervalType: '1m' | '1d';
  readonly fromIso: string;
  readonly toIso: string;
}

export interface ChartCatchupResult {
  readonly candlesWritten: number;
  readonly candlesSkipped: number;
  readonly errors: ReadonlyArray<{ code: string; detail: string }>;
}

@Injectable()
export class ChartCatchupService {
  private readonly logger = new Logger(ChartCatchupService.name);

  constructor(
    @Inject(COLLECTOR_BROKERAGE_VENDOR) private readonly gateway: BrokerageVendor,
    @Inject(CANDLE_REPOSITORY) private readonly repo: CandleRepository,
  ) {}

  async run(request: ChartCatchupRequest): Promise<ChartCatchupResult> {
    const errors: { code: string; detail: string }[] = [];
    let written = 0;
    let skipped = 0;

    try {
      const rows: MarketCandleClosedPayload[] = await this.gateway.fetchChartCandles({
        symbol: request.symbol,
        marketEnv: request.marketEnv,
        intervalType: request.intervalType,
        fromIso: request.fromIso,
        toIso: request.toIso,
      });

      for (const row of rows) {
        const r = await this.repo.upsertClosed(row);

        if (r === 'skipped') skipped += 1;
        else written += 1;
      }
    } catch (err) {
      errors.push({
        code: 'kiwoom-chart-failed',
        detail: err instanceof Error ? err.message : String(err),
      });

      this.logger.warn(
        `catchup request=${request.requestId} failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    return { candlesWritten: written, candlesSkipped: skipped, errors };
  }
}
