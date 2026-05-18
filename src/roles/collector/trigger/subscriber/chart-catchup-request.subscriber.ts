import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { BUS_QUEUE } from '@shared/bus/bus.token';
import type { BusQueue } from '@shared/bus/bus-queue.interface';
import { REDIS_SUBSCRIBER, type RedisClientToken } from '@shared/cache/redis.module';
import type { ChartCatchupRequest } from '@roles/collector/service/chart-catchup.service';

const REQUEST_CHANNEL = 'chart:catchup:request';
const QUEUE_NAME = 'chart-catchup';

// Phase E: BE publishes a JSON ChartCatchupRequest payload on
// `chart:catchup:request`; this subscriber enqueues each request into
// the BullMQ `chart-catchup` queue. Worker-side consumer
// (chart-catchup.consumer.ts) drains the queue and runs the catchup.
//
// We bypass RedisBusSubscriber here because that helper expects the
// WorkerEvent envelope. BE publishes a flat ChartCatchupRequest — using
// a dedicated subscriber on REDIS_SUBSCRIBER keeps the contract clean.
@Injectable()
export class ChartCatchupRequestSubscriber
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ChartCatchupRequestSubscriber.name);

  private listenerAttached = false;

  constructor(
    @Optional() @Inject(REDIS_SUBSCRIBER) private readonly subscriber: RedisClientToken,
    @Inject(BUS_QUEUE) private readonly queue: BusQueue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.subscriber) {
      this.logger.warn('REDIS_SUBSCRIBER unavailable — chart-catchup request channel inactive');

      return;
    }

    if (!this.listenerAttached) {
      this.subscriber.on('message', (channel: string, raw: string) => {
        if (channel !== REQUEST_CHANNEL) return;

        this.handle(raw).catch((err) =>
          this.logger.warn(
            `chart-catchup request handle failed: ${err instanceof Error ? err.message : err}`,
          ),
        );
      });

      this.listenerAttached = true;
    }

    await this.subscriber.subscribe(REQUEST_CHANNEL);

    this.logger.log(`subscribed: ${REQUEST_CHANNEL}`);
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.subscriber) return;

    try {
      await this.subscriber.unsubscribe(REQUEST_CHANNEL);
    } catch (err) {
      this.logger.warn(
        `unsubscribe ${REQUEST_CHANNEL} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private async handle(raw: string): Promise<void> {
    let payload: ChartCatchupRequest;

    try {
      payload = JSON.parse(raw) as ChartCatchupRequest;
    } catch {
      this.logger.warn(`chart-catchup request: invalid JSON payload, dropping`);

      return;
    }

    if (!this.isValid(payload)) {
      this.logger.warn(
        `chart-catchup request: missing required fields (requestId/symbol/...), dropping`,
      );

      return;
    }

    // jobId = requestId so duplicate publishes collapse to one job.
    await this.queue.enqueue<ChartCatchupRequest>(QUEUE_NAME, payload, {
      jobId: payload.requestId,
      attempts: 3,
    });

    this.logger.debug(
      `enqueued chart-catchup request=${payload.requestId} symbol=${payload.symbol}`,
    );
  }

  private isValid(payload: ChartCatchupRequest): boolean {
    return (
      typeof payload?.requestId === 'string' &&
      typeof payload?.symbol === 'string' &&
      (payload.marketEnv === 'mock' || payload.marketEnv === 'production') &&
      (payload.intervalType === '1m' || payload.intervalType === '1d') &&
      typeof payload.fromIso === 'string' &&
      typeof payload.toIso === 'string'
    );
  }
}
