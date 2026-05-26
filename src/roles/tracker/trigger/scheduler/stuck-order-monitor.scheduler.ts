import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { MonitorStuckOrdersUsecase } from '@roles/tracker/usecase/monitor-stuck-orders.usecase';

const SCHEDULER_NAME = 'tracker.stuck-order-monitor';
const INTERVAL_MS = readPositiveInt(
  process.env.TRACKER_STUCK_ORDER_MONITOR_INTERVAL_MS,
  60_000,
);

@Injectable()
export class StuckOrderMonitorScheduler implements OnModuleInit {
  private readonly logger = new Logger(StuckOrderMonitorScheduler.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly usecase: MonitorStuckOrdersUsecase,
  ) {}

  onModuleInit(): void {
    const handle = setInterval(() => {
      this.usecase.execute().catch((err) => {
        this.logger.warn(
          `stuck-order monitor error: ${err instanceof Error ? err.message : err}`,
        );
      });
    }, INTERVAL_MS);

    this.registry.addInterval(SCHEDULER_NAME, handle);
    this.logger.log(`scheduler ${SCHEDULER_NAME} every ${Math.round(INTERVAL_MS / 1000)}s`);
  }
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
