import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PickupCancellingOrdersUsecase } from '@roles/executor/usecase/pickup-cancelling-orders.usecase';
import { PickupRequestedOrdersUsecase } from '@roles/executor/usecase/pickup-requested-orders.usecase';
import { WorkerPolicyCache } from '@shared/policy/worker-policy.cache';

const SCHEDULER_NAME = 'executor.order-pickup';
const DEFAULT_INTERVAL_MS = 500;

// Phase J: short-cycle drain of the BE-owned `orders` table. REQUESTED
// rows become vendor place-order calls; CANCEL_REQUESTED rows become
// vendor cancel calls. Interval is policy-driven so an operator can dial
// the cadence per environment without redeploying.
@Injectable()
export class OrderPickupScheduler implements OnModuleInit {
  private readonly logger = new Logger(OrderPickupScheduler.name);

  private running = false;

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly requestedUsecase: PickupRequestedOrdersUsecase,
    private readonly cancellingUsecase: PickupCancellingOrdersUsecase,
    private readonly policies: WorkerPolicyCache,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.policies.get<number>(
      'executor_pickup_interval_ms',
      DEFAULT_INTERVAL_MS,
    );

    const handle = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.warn(
          `order-pickup scheduler error: ${err instanceof Error ? err.message : err}`,
        ),
      );
    }, intervalMs);

    this.registry.addInterval(SCHEDULER_NAME, handle);

    this.logger.log(`scheduler ${SCHEDULER_NAME} every ${intervalMs}ms`);
  }

  private async tick(): Promise<void> {
    // Re-entrancy guard: a slow vendor / DB ride must not start a second
    // pickup loop on top of itself. The interval keeps firing but each
    // overlap is dropped — pickups always come back to drain on the
    // next free tick.
    if (this.running) return;

    this.running = true;

    try {
      await this.requestedUsecase.execute();
      await this.cancellingUsecase.execute();
    } finally {
      this.running = false;
    }
  }
}
