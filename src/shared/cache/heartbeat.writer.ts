import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { REDIS_CONFIG, type RedisConfig } from '@config/redis.config';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import { REDIS_CLIENT, type RedisClientToken } from './redis.module';
import { RedisKeyBuilder } from './redis-key.builder';

// Optional role-scoped metrics blob written into the heartbeat JSON.
// Phase 9 collector writes universe_size / observed_admin_count /
// observed_fe_count / active_subscriptions here so BE admin dashboards
// can read them from the redis worker heartbeat hash without an extra
// round trip. Values must be JSON-serializable primitives.
export type HeartbeatMetrics = Readonly<Record<string, number | string | boolean | null>>;

@Injectable()
export class HeartbeatWriter {
  private readonly logger = new Logger(HeartbeatWriter.name);

  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly client: RedisClientToken,
    @Inject(REDIS_CONFIG) private readonly redisConfig: RedisConfig,
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    private readonly keys: RedisKeyBuilder,
  ) {}

  async tick(metrics?: HeartbeatMetrics): Promise<void> {
    if (!this.client) return;

    const key = this.keys.build('heartbeat', this.runtime.workerInstanceId);
    const value = JSON.stringify({
      ts: new Date().toISOString(),
      roles: this.runtime.roles,
      shard:
        this.runtime.shardIndex !== undefined && this.runtime.shardCount !== undefined
          ? { index: this.runtime.shardIndex, count: this.runtime.shardCount }
          : undefined,
      metrics: metrics ?? undefined,
    });

    await this.client.set(key, value, 'EX', this.redisConfig.heartbeatTtlSec);
  }
}
