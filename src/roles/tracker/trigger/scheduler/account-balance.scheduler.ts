import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { TRACKER_CONFIG, type TrackerConfig } from '@config/tracker.config';
import { SyncAccountBalanceUsecase } from '@roles/tracker/usecase/sync-account-balance.usecase';
import { WorkerPolicyCache } from '@shared/policy/worker-policy.cache';

const SCHEDULER_NAME = 'tracker.account-balance';

// Phase 9: interval first consults BE worker-policy
// (`balance_poll_interval_sec`); the env-driven TrackerConfig value is
// the fallback so dev environments without BE policies still tick.
@Injectable()
export class AccountBalanceScheduler implements OnModuleInit {
  private readonly logger = new Logger(AccountBalanceScheduler.name);

  constructor(
    @Inject(TRACKER_CONFIG) private readonly config: TrackerConfig,
    private readonly registry: SchedulerRegistry,
    private readonly usecase: SyncAccountBalanceUsecase,
    private readonly policies: WorkerPolicyCache,
  ) {}

  onModuleInit(): void {
    const sec = this.policies.get<number>(
      'balance_poll_interval_sec',
      this.config.balancePollIntervalSec,
    );
    const intervalMs = sec * 1000;

    const handle = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.warn(
          `account-balance scheduler error: ${err instanceof Error ? err.message : err}`,
        ),
      );
    }, intervalMs);

    this.registry.addInterval(SCHEDULER_NAME, handle);

    this.logger.log(`scheduler ${SCHEDULER_NAME} every ${sec}s`);

    this.tick().catch((err) =>
      this.logger.warn(
        `account-balance initial sync error: ${err instanceof Error ? err.message : err}`,
      ),
    );
  }

  private async tick(): Promise<void> {
    await this.usecase.execute();
  }
}
