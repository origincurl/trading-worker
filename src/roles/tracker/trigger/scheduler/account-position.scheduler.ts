import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { TRACKER_CONFIG, type TrackerConfig } from '@config/tracker.config';
import { SyncAccountPositionUsecase } from '@roles/tracker/usecase/sync-account-position.usecase';
import { WorkerPolicyCache } from '@shared/policy/worker-policy.cache';

const SCHEDULER_NAME = 'tracker.account-position';

// Phase 9: interval is BE-policy-first (`position_poll_interval_sec`),
// env fallback. See account-balance.scheduler for the same pattern.
@Injectable()
export class AccountPositionScheduler implements OnModuleInit {
  private readonly logger = new Logger(AccountPositionScheduler.name);

  constructor(
    @Inject(TRACKER_CONFIG) private readonly config: TrackerConfig,
    private readonly registry: SchedulerRegistry,
    private readonly usecase: SyncAccountPositionUsecase,
    private readonly policies: WorkerPolicyCache,
  ) {}

  onModuleInit(): void {
    const sec = this.policies.get<number>(
      'position_poll_interval_sec',
      this.config.positionPollIntervalSec,
    );
    const intervalMs = sec * 1000;

    const handle = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.warn(
          `account-position scheduler error: ${err instanceof Error ? err.message : err}`,
        ),
      );
    }, intervalMs);

    this.registry.addInterval(SCHEDULER_NAME, handle);

    this.logger.log(`scheduler ${SCHEDULER_NAME} every ${sec}s`);
  }

  private async tick(): Promise<void> {
    await this.usecase.execute();
  }
}
