import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { IngestExecutionUsecase } from '@roles/tracker/usecase/ingest-execution.usecase';

const SCHEDULER_NAME = 'tracker.fill-maintenance';
const INTERVAL_MS = readPositiveInt(
  process.env.TRACKER_FILL_MAINTENANCE_INTERVAL_MS,
  5_000,
);
const BATCH_SIZE = readPositiveInt(process.env.TRACKER_FILL_MAINTENANCE_BATCH_SIZE, 25);

@Injectable()
export class FillMaintenanceScheduler implements OnModuleInit {
  private readonly logger = new Logger(FillMaintenanceScheduler.name);

  private running = false;

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly usecase: IngestExecutionUsecase,
  ) {}

  onModuleInit(): void {
    const handle = setInterval(() => {
      this.run().catch((err) => {
        this.logger.warn(
          `fill-maintenance error: ${err instanceof Error ? err.message : err}`,
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
      await this.usecase.retryUnmatched(BATCH_SIZE);
      await this.usecase.flushOutbox(BATCH_SIZE);
    } finally {
      this.running = false;
    }
  }
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
