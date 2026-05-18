import {
  Global,
  Inject,
  Logger,
  Module,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
  type Provider,
} from '@nestjs/common';
import { Redis, type RedisOptions } from 'ioredis';
import { REDIS_CONFIG, type RedisConfig } from '@config/redis.config';
import { HeartbeatWriter } from './heartbeat.writer';
import { LatestPriceWriter } from './latest-price.writer';
import { RedisKeyBuilder } from './redis-key.builder';
import { REDIS_CLIENT, REDIS_SUBSCRIBER, type RedisClientToken } from './redis.tokens';

// Nest rejects `null` from useFactory but accepts `undefined` when the
// consumer marks the parameter @Optional(). All consumers of REDIS_CLIENT /
// REDIS_SUBSCRIBER MUST decorate their injection with @Optional() and handle
// the disabled case explicitly.
export { REDIS_CLIENT, REDIS_SUBSCRIBER, type RedisClientToken } from './redis.tokens';

const REDIS_CONNECT_OPTIONS: RedisOptions = {
  maxRetriesPerRequest: null,
  enableAutoPipelining: true,
  lazyConnect: true,
};

const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [REDIS_CONFIG],
  useFactory: (config: RedisConfig): RedisClientToken =>
    config.url ? new Redis(config.url, REDIS_CONNECT_OPTIONS) : undefined,
};

const redisSubscriberProvider: Provider = {
  provide: REDIS_SUBSCRIBER,
  inject: [REDIS_CONFIG],
  useFactory: (config: RedisConfig): RedisClientToken =>
    config.url ? new Redis(config.url, REDIS_CONNECT_OPTIONS) : undefined,
};

@Global()
@Module({
  providers: [
    redisClientProvider,
    redisSubscriberProvider,
    RedisKeyBuilder,
    LatestPriceWriter,
    HeartbeatWriter,
  ],
  exports: [REDIS_CLIENT, REDIS_SUBSCRIBER, RedisKeyBuilder, LatestPriceWriter, HeartbeatWriter],
})
export class RedisModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisModule.name);

  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly client: RedisClientToken,
    @Optional() @Inject(REDIS_SUBSCRIBER) private readonly subscriber: RedisClientToken,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.client || !this.subscriber) {
      this.logger.warn(
        'REDIS_URL not set — Redis client running in disabled mode. Bus + cache operations will no-op or error.',
      );

      return;
    }

    // Connection failures must not block boot. Ops still want /live and
    // /ready to come up so probes can report the degraded state. ioredis
    // keeps retrying in the background, and /ready surfaces ping failures.
    this.client.on('error', (err) => this.logger.warn(`redis client error: ${err.message}`));

    this.subscriber.on('error', (err) =>
      this.logger.warn(`redis subscriber error: ${err.message}`),
    );

    const results = await Promise.allSettled([this.client.connect(), this.subscriber.connect()]);

    const failures = results.filter((r) => r.status === 'rejected');

    if (failures.length === 0) {
      this.logger.log('Redis clients connected (primary + subscriber)');
    } else {
      this.logger.warn(
        `Redis connect failed at boot (${failures.length}/${results.length}) — proceeding degraded; /ready will report down`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.client?.quit(), this.subscriber?.quit()].filter(Boolean));
  }
}
