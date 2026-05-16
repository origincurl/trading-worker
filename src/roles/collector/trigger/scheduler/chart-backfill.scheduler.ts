import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import {
  BE_CONTROL_PLANE_CLIENT,
  type BeControlPlaneClient,
} from '@external/be-control-plane/client/be-control-plane.client';
import { ProcessChartBackfillLeaseUsecase } from '@roles/collector/usecase/process-chart-backfill-lease.usecase';

const POLL_INTERVAL_MS = 30_000;
const MAX_CONCURRENCY = 2;

// Polls BE for chart-backfill leases at a fixed interval and processes
// them with bounded concurrency. Lease lifetime is respected — if a lease
// would exceed `expiresAt`, BE will re-issue and the worker reports
// partial outcome on the second attempt.
@Injectable()
export class ChartBackfillScheduler {
  private readonly logger = new Logger(ChartBackfillScheduler.name);

  private inFlight = 0;

  private _completedToday = 0;

  private _failedToday = 0;

  constructor(
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
    @Inject(BE_CONTROL_PLANE_CLIENT) private readonly be: BeControlPlaneClient,
    private readonly usecase: ProcessChartBackfillLeaseUsecase,
  ) {}

  inFlightCount(): number {
    return this.inFlight;
  }

  completedToday(): number {
    return this._completedToday;
  }

  failedToday(): number {
    return this._failedToday;
  }

  @Interval('collector.chart-backfill', POLL_INTERVAL_MS)
  async tick(): Promise<void> {
    const want = Math.max(0, MAX_CONCURRENCY - this.inFlight);

    if (want === 0) return;

    const acquire = await this.be.acquireChartBackfillLease({
      marketEnv: this.kiwoom.marketEnv,
      maxLeases: want,
    });

    if (acquire.kind !== 'success') {
      this.logger.warn(`backfill lease acquire failed: kind=${acquire.kind}`);

      return;
    }

    for (const lease of acquire.data.leases) {
      this.inFlight += 1;

      // Run async; do not block the scheduler tick on lease processing.
      void this.processOne(lease).finally(() => {
        this.inFlight -= 1;
      });
    }
  }

  private async processOne(
    lease: import('@external/be-control-plane/model/chart-backfill-lease.model').ChartBackfillLeaseModel,
  ): Promise<void> {
    try {
      const outcome = await this.usecase.execute(lease);

      if (outcome.errors.length === 0) this._completedToday += 1;
      else this._failedToday += 1;

      const reported = await this.be.reportChartBackfillOutcome(outcome);

      if (reported.kind !== 'success') {
        this.logger.warn(`outcome report failed lease=${lease.leaseId} kind=${reported.kind}`);
      }
    } catch (err) {
      this._failedToday += 1;

      this.logger.warn(
        `backfill lease=${lease.leaseId} crashed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
