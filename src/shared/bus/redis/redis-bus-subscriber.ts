import { Inject, Injectable, Logger, Optional, type OnModuleDestroy } from '@nestjs/common';
import { REDIS_SUBSCRIBER, type RedisClientToken } from '@shared/cache/redis.module';
import type { WorkerEvent } from '@shared/event/worker-event';
import type { BusSubscriber, PubsubMessageHandler } from '../bus-publisher.interface';

@Injectable()
export class RedisBusSubscriber implements BusSubscriber, OnModuleDestroy {
  private readonly logger = new Logger(RedisBusSubscriber.name);

  private readonly handlers = new Map<string, PubsubMessageHandler>();

  private listenerAttached = false;

  constructor(
    @Optional() @Inject(REDIS_SUBSCRIBER) private readonly subscriber: RedisClientToken,
  ) {}

  async subscribe<T>(channel: string, handler: PubsubMessageHandler<T>): Promise<void> {
    if (!this.subscriber) {
      this.logger.warn(`subscribe ignored (Redis disabled): channel=${channel}`);

      return;
    }

    this.handlers.set(channel, handler as PubsubMessageHandler);

    this.ensureMessageListener();

    await this.subscriber.subscribe(channel);
  }

  async unsubscribe(channel: string): Promise<void> {
    this.handlers.delete(channel);

    if (this.subscriber) {
      await this.subscriber.unsubscribe(channel);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.handlers.clear();
  }

  private ensureMessageListener(): void {
    if (this.listenerAttached || !this.subscriber) return;

    this.subscriber.on('message', (channel: string, raw: string) => {
      const handler = this.handlers.get(channel);

      if (!handler) return;

      try {
        const event = JSON.parse(raw) as WorkerEvent;

        Promise.resolve(handler(event, channel)).catch((err) => {
          this.logger.error(`pubsub handler failed on ${channel}: ${err}`);
        });
      } catch {
        this.logger.warn(`pubsub payload JSON parse failed on ${channel} — dropping`);
      }
    });

    this.listenerAttached = true;
  }
}
