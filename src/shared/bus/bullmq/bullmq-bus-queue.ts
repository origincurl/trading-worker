import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { IntegrationError } from '@common/error/domain.error';
import { REDIS_CONFIG, type RedisConfig } from '@config/redis.config';
import type {
  BusQueue,
  BusQueueProcessor,
  CreateProcessorOptions,
  EnqueueOptions,
  QueueHandler,
} from '../bus-queue.interface';

@Injectable()
export class BullMqBusQueue implements BusQueue, OnModuleDestroy {
  private readonly logger = new Logger(BullMqBusQueue.name);

  private readonly queues = new Map<string, Queue>();

  private readonly workers: Worker[] = [];

  constructor(@Inject(REDIS_CONFIG) private readonly config: RedisConfig) {}

  async enqueue<T>(queue: string, payload: T, opts?: EnqueueOptions): Promise<void> {
    if (!this.config.url) {
      throw new IntegrationError('Redis disabled — cannot enqueue', { queue });
    }

    const q = this.getOrCreateQueue(queue);

    await q.add(opts?.jobId ?? queue, payload, {
      jobId: opts?.jobId,
      delay: opts?.delayMs,
      attempts: opts?.attempts,
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  createProcessor<T>(opts: CreateProcessorOptions, handler: QueueHandler<T>): BusQueueProcessor {
    if (!this.config.url) {
      throw new IntegrationError('Redis disabled — cannot create processor', {
        queue: opts.queue,
      });
    }

    let worker: Worker | undefined;

    return {
      start: async () => {
        if (worker) return;

        worker = new Worker<T>(
          opts.queue,
          async (job: Job<T>) => {
            await handler({
              id: job.id ?? '',
              data: job.data,
              attemptsMade: job.attemptsMade,
            });
          },
          {
            connection: this.connection(),
            concurrency: opts.concurrency ?? 1,
          },
        );

        worker.on('failed', (job, err) => {
          this.logger.error(
            `queue=${opts.queue} job=${job?.id ?? '?'} failed (attempt ${job?.attemptsMade}): ${err.message}`,
          );
        });

        this.workers.push(worker);
      },
      stop: async () => {
        await worker?.close();

        worker = undefined;
      },
    };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));

    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }

  private getOrCreateQueue(name: string): Queue {
    const existing = this.queues.get(name);

    if (existing) return existing;

    const q = new Queue(name, { connection: this.connection() });

    this.queues.set(name, q);

    return q;
  }

  private connection(): ConnectionOptions {
    // BullMQ accepts either a URL string or an ioredis options object.
    // We pass options so the maxRetriesPerRequest: null hint that BullMQ
    // mandates is set explicitly.
    return {
      url: this.config.url,
      maxRetriesPerRequest: null,
    } as ConnectionOptions;
  }
}
