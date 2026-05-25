import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BrokerReconciliationUsecase } from '@roles/tracker/usecase/broker-reconciliation.usecase';

const SCHEDULER_NAME = 'tracker.broker-reconciliation';
const INTERVAL_MS = readPositiveInt(
  process.env.TRACKER_BROKER_RECONCILIATION_INTERVAL_MS,
  60_000,
);

@Injectable()
export class BrokerReconciliationScheduler implements OnModuleInit {
  private readonly logger = new Logger(BrokerReconciliationScheduler.name);

  private running = false;

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly usecase: BrokerReconciliationUsecase,
  ) {}

  onModuleInit(): void {
    const handle = setInterval(() => {
      this.run().catch((err) => {
        this.logger.warn(
          `broker-reconciliation error: ${err instanceof Error ? err.message : err}`,
        );
      });
    }, INTERVAL_MS);

    this.registry.addInterval(SCHEDULER_NAME, handle);
    this.logger.log(`scheduler ${SCHEDULER_NAME} every ${Math.round(INTERVAL_MS / 1000)}s`);
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      await this.usecase.execute();
    } finally {
      this.running = false;
    }
  }
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
