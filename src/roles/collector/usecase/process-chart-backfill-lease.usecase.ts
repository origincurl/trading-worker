import { Inject, Injectable, Logger } from '@nestjs/common';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import {
  BE_CONTROL_PLANE_CLIENT,
  type BeControlPlaneClient,
} from '@external/be-control-plane/client/be-control-plane.client';
import type {
  ChartBackfillLeaseModel,
  ChartBackfillOutcomePayload,
} from '@external/be-control-plane/model/chart-backfill-lease.model';
import { rowToCandlePayload } from '@roles/collector/mapper/kiwoom-chart-candle.mapper';
import { CandleCloseService } from '@roles/collector/service/candle-close.service';
import {
  CANDLE_REPOSITORY,
  type CandleRepository,
} from '@roles/collector/repository/candle.repository';

// Phase 6.10: process a single chart-backfill lease.
//   1. Call Kiwoom REST chart endpoint (stub today — real REST lands when
//      KiwoomApiClient.request gains a body).
//   2. Map response → MarketCandleClosedPayload[]
//   3. Repo upsert (realtime-priority policy guards against overwrite)
//   4. Report outcome back to BE
@Injectable()
export class ProcessChartBackfillLeaseUsecase {
  private readonly logger = new Logger(ProcessChartBackfillLeaseUsecase.name);

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    @Inject(BE_CONTROL_PLANE_CLIENT) private readonly be: BeControlPlaneClient,
    @Inject(CANDLE_REPOSITORY) private readonly repo: CandleRepository,
    private readonly candleClose: CandleCloseService,
  ) {}

  async execute(lease: ChartBackfillLeaseModel): Promise<ChartBackfillOutcomePayload> {
    const startedAt = new Date().toISOString();
    const errors: { code: string; detail: string }[] = [];

    let written = 0;
    let skipped = 0;

    try {
      // Phase 6.10 placeholder: the real Kiwoom chart REST call lands here.
      // Until then we treat the lease as a no-op and report empty outcome
      // — BE can record that the worker acknowledged the lease.
      const rows: ReturnType<typeof rowToCandlePayload>[] = [];

      for (const row of rows) {
        const r = await this.repo.upsertClosed(row);

        if (r === 'skipped') skipped += 1;
        else written += 1;
      }

      void this.candleClose;
    } catch (err) {
      errors.push({
        code: 'kiwoom-chart-failed',
        detail: err instanceof Error ? err.message : String(err),
      });

      this.logger.warn(
        `backfill lease=${lease.leaseId} failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    return {
      leaseId: lease.leaseId,
      workerInstanceId: this.runtime.workerInstanceId,
      symbol: lease.symbol,
      intervalType: lease.intervalType,
      fromIso: lease.fromIso,
      toIso: lease.toIso,
      candlesWritten: written,
      candlesSkipped: skipped,
      errors,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
}
