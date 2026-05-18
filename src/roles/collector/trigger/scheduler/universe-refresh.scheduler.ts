import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { RefreshUniverseUsecase } from '@roles/collector/usecase/refresh-universe.usecase';
import { WorkerPolicyCache } from '@shared/policy/worker-policy.cache';

const SCHEDULER_NAME = 'collector.universe-refresh';
const DEFAULT_INTERVAL_SEC = 60;

// Interval is driven by worker-policy key `universe_refresh_interval_sec`
// (cached snapshot, refreshed by WorkerPolicyCache). Mirrors the tracker
// schedulers — we register via SchedulerRegistry because the @Interval
// decorator only accepts compile-time constants.
@Injectable()
export class UniverseRefreshScheduler implements OnModuleInit {
  private readonly logger = new Logger(UniverseRefreshScheduler.name);

  constructor(
    private readonly usecase: RefreshUniverseUsecase,
    private readonly registry: SchedulerRegistry,
    private readonly policies: WorkerPolicyCache,
  ) {}

  onModuleInit(): void {
    const sec = this.policies.get<number>('universe_refresh_interval_sec', DEFAULT_INTERVAL_SEC);
    const intervalMs = sec * 1000;

    const handle = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.warn(`universe refresh error: ${err instanceof Error ? err.message : err}`),
      );
    }, intervalMs);

    this.registry.addInterval(SCHEDULER_NAME, handle);

    this.logger.log(`scheduler ${SCHEDULER_NAME} every ${sec}s`);
  }

  private async tick(): Promise<void> {
    await this.usecase.execute();
  }
}
