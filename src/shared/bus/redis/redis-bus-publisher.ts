import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { IntegrationError } from '@common/error/domain.error';
import { REDIS_CLIENT, type RedisClientToken } from '@shared/cache/redis.module';
import type { WorkerEvent } from '@shared/event/worker-event';
import type { BusPublisher } from '../bus-publisher.interface';

@Injectable()
export class RedisBusPublisher implements BusPublisher {
  private readonly logger = new Logger(RedisBusPublisher.name);

  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly client: RedisClientToken) {}

  async publish<T>(channel: string, event: WorkerEvent<T>): Promise<void> {
    if (!this.client) {
      // Pub/sub is fire-and-forget; without Redis we drop silently and
      // emit a single warn so the operator notices but the producer path
      // does not crash. The consumer side will simply never receive.
      this.logger.warn(`publish dropped (Redis disabled): channel=${channel}`);

      return;
    }

    try {
      await this.client.publish(channel, JSON.stringify(event));
    } catch (err) {
      throw new IntegrationError(`Redis publish failed on channel ${channel}`, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
