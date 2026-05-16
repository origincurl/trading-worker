import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { WorkerEvent } from '@shared/event/worker-event';
import type { RedisBusSubscriber } from '../redis/redis-bus-subscriber';

export interface ChannelBinding<T = unknown> {
  readonly channel: string;
  readonly handle: (event: WorkerEvent<T>) => Promise<void> | void;
}

@Injectable()
export abstract class RedisSubscriberBase implements OnApplicationBootstrap, OnApplicationShutdown {
  protected readonly logger = new Logger(this.constructor.name);

  constructor(protected readonly subscriber: RedisBusSubscriber) {}

  protected abstract bindings(): ReadonlyArray<ChannelBinding>;

  async onApplicationBootstrap(): Promise<void> {
    for (const binding of this.bindings()) {
      await this.subscriber.subscribe(binding.channel, (event) => binding.handle(event));

      this.logger.log(`subscribed: ${binding.channel}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    for (const binding of this.bindings()) {
      await this.subscriber.unsubscribe(binding.channel);
    }
  }
}
