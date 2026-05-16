import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type {
  BusQueue,
  BusQueueJob,
  BusQueueProcessor,
  CreateProcessorOptions,
} from '../bus-queue.interface';

@Injectable()
export abstract class BullMqProcessorBase<T = unknown>
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  protected readonly logger = new Logger(this.constructor.name);

  private processor?: BusQueueProcessor;

  constructor(protected readonly queue: BusQueue) {}

  protected abstract options(): CreateProcessorOptions;

  protected abstract handle(job: BusQueueJob<T>): Promise<void>;

  async onApplicationBootstrap(): Promise<void> {
    const opts = this.options();

    this.processor = this.queue.createProcessor<T>(opts, (job) => this.handle(job));

    // Bound start() — same reasoning as StreamsConsumerBase: BullMQ's
    // Worker constructor will sit on a disconnected Redis indefinitely.
    const startTimeoutMs = 2_000;
    const start = this.processor.start();
    const timeout = new Promise<'TIMEOUT'>((resolve) =>
      setTimeout(() => resolve('TIMEOUT'), startTimeoutMs),
    );

    try {
      const result = await Promise.race([start.then(() => 'OK'), timeout]);

      if (result === 'TIMEOUT') {
        this.logger.warn(
          `queue processor start timed out after ${startTimeoutMs}ms (${opts.queue}) — degraded boot`,
        );
      } else {
        this.logger.log(
          `queue processor started: ${opts.queue} (concurrency=${opts.concurrency ?? 1})`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `queue processor failed to start (${opts.queue}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.processor?.stop();
  }
}
