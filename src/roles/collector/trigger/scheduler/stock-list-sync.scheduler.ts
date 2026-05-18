import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { SyncStockListUsecase } from '@roles/collector/usecase/sync-stock-list.usecase';
import { WorkerPolicyCache } from '@shared/policy/worker-policy.cache';

const SCHEDULER_NAME = 'collector.stock-list-sync';
const DEFAULT_INTERVAL_SEC = 21_600; // 6h

// Phase E: periodic vendor stock-master sync. Interval comes from
// worker_policies `stock_list_sync_interval_sec`; gated by
// COLLECTOR_STOCK_LIST_SYNC_ENABLED env so dev can flip it off without
// touching DB.
@Injectable()
export class StockListSyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(StockListSyncScheduler.name);

  constructor(
    private readonly usecase: SyncStockListUsecase,
    private readonly registry: SchedulerRegistry,
    private readonly policies: WorkerPolicyCache,
  ) {}

  onModuleInit(): void {
    const enabled =
      (process.env.COLLECTOR_STOCK_LIST_SYNC_ENABLED ?? 'true').toLowerCase() !== 'false';

    if (!enabled) {
      this.logger.log('stock list sync disabled via COLLECTOR_STOCK_LIST_SYNC_ENABLED=false');

      return;
    }

    const sec = this.policies.get<number>('stock_list_sync_interval_sec', DEFAULT_INTERVAL_SEC);
    const intervalMs = sec * 1000;

    const handle = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.warn(`stock list sync error: ${err instanceof Error ? err.message : err}`),
      );
    }, intervalMs);

    this.registry.addInterval(SCHEDULER_NAME, handle);

    this.logger.log(`scheduler ${SCHEDULER_NAME} every ${sec}s`);
  }

  private async tick(): Promise<void> {
    await this.usecase.execute();
  }
}
