import { Inject, Injectable } from '@nestjs/common';
import { BUS_QUEUE } from '@shared/bus/bus.token';
import type { BusQueue, BusQueueJob, CreateProcessorOptions } from '@shared/bus/bus-queue.interface';
import { BullMqProcessorBase } from '@shared/bus/trigger/bullmq-processor.base';
import type { ChartCatchupRequest } from '@roles/collector/service/chart-catchup.service';
import { ProcessChartCatchupUsecase } from '@roles/collector/usecase/process-chart-catchup.usecase';

const QUEUE_NAME = 'chart-catchup';
const DEFAULT_CONCURRENCY = 2;

// Phase E: BullMQ consumer for the chart-catchup queue. Subscriber
// publishes to redis, this drains the queue via
// ProcessChartCatchupUsecase. Concurrency is conservative (2) — chart
// fetches are network-bound; raise via worker_policies if needed.
@Injectable()
export class ChartCatchupConsumer extends BullMqProcessorBase<ChartCatchupRequest> {
  constructor(
    @Inject(BUS_QUEUE) queue: BusQueue,
    private readonly usecase: ProcessChartCatchupUsecase,
  ) {
    super(queue);
  }

  protected options(): CreateProcessorOptions {
    return { queue: QUEUE_NAME, concurrency: DEFAULT_CONCURRENCY };
  }

  protected async handle(job: BusQueueJob<ChartCatchupRequest>): Promise<void> {
    await this.usecase.execute(job.data);
  }
}
