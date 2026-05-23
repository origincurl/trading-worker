import { Inject, Injectable, Logger, Optional, type Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { REDIS_CONFIG, type RedisConfig } from '@config/redis.config';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import { REDIS_CLIENT, type RedisClientToken } from './redis.tokens';
import { RedisKeyBuilder } from './redis-key.builder';
import {
  CredentialUsageService,
  type CredentialUsageSnapshot,
} from '@external/brokerage/credential/credential-usage.service';
import type { SubscriptionStateSnapshot } from '@roles/collector/usecase/refresh-universe.usecase';

// Optional role-scoped metrics blob written into the heartbeat JSON.
// Phase 9 collector writes universe_size / observed_fe_count /
// strategy_desired_count / active_subscriptions here so BE admin dashboards
// can read them from the redis worker heartbeat hash without an extra round
// trip. Values must be JSON-serializable primitives.
export type HeartbeatMetrics = Readonly<Record<string, number | string | boolean | null>>;

export interface RoleMetricSnapshot {
  readonly role: string;
  readonly metrics: HeartbeatMetrics;
  readonly subscriptionState?: SubscriptionStateSnapshot;
}

export interface WorkerHeartbeatPayload {
  readonly ts: string;
  readonly roles: readonly string[];
  readonly shard?: { readonly index: number; readonly count: number };
  readonly metrics?: HeartbeatMetrics;
  readonly roleMetrics?: Readonly<Record<string, Omit<RoleMetricSnapshot, 'role'>>>;
  readonly credentialUsage?: readonly CredentialUsageSnapshot[];
  readonly subscriptionState?: SubscriptionStateSnapshot;
}

@Injectable()
export class HeartbeatWriter {
  private readonly logger = new Logger(HeartbeatWriter.name);

  private warnedRedisDisabled = false;

  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly client: RedisClientToken,
    @Inject(REDIS_CONFIG) private readonly redisConfig: RedisConfig,
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    private readonly keys: RedisKeyBuilder,
    private readonly moduleRef: ModuleRef,
  ) {}

  async tick(
    metrics?: HeartbeatMetrics,
    options?: {
      subscriptionState?: SubscriptionStateSnapshot;
      roleMetrics?: readonly RoleMetricSnapshot[];
    },
  ): Promise<void> {
    if (!this.client) {
      if (!this.warnedRedisDisabled) {
        this.logger.warn('Redis client is disabled; worker heartbeat will not be published');

        this.warnedRedisDisabled = true;
      }

      return;
    }

    const key = this.keys.build('heartbeat', this.runtime.workerInstanceId);
    const roleMetrics = toRoleMetricsRecord(options?.roleMetrics);
    const collectorRoleMetrics = roleMetrics?.collector;
    const topLevelMetrics = metrics ?? collectorRoleMetrics?.metrics;
    const topLevelSubscriptionState =
      options?.subscriptionState ?? collectorRoleMetrics?.subscriptionState;
    const credentialUsage = this.getCredentialUsageSnapshot();
    const payload: WorkerHeartbeatPayload = {
      ts: new Date().toISOString(),
      roles: this.runtime.roles,
      shard:
        this.runtime.shardIndex !== undefined && this.runtime.shardCount !== undefined
          ? { index: this.runtime.shardIndex, count: this.runtime.shardCount }
          : undefined,
      metrics: topLevelMetrics ?? undefined,
      roleMetrics,
      credentialUsage,
      subscriptionState: topLevelSubscriptionState,
    };
    const value = JSON.stringify(payload);

    await this.client.setex(key, this.redisConfig.heartbeatTtlSec, value);
  }

  private getCredentialUsageSnapshot(): readonly CredentialUsageSnapshot[] | undefined {
    const usage = this.getOptional(CredentialUsageService);

    return usage?.snapshot();
  }

  private getOptional<T>(token: Type<T>): T | undefined {
    try {
      return this.moduleRef.get(token, { strict: false });
    } catch {
      return undefined;
    }
  }
}

function toRoleMetricsRecord(
  snapshots: readonly RoleMetricSnapshot[] | undefined,
): Readonly<Record<string, Omit<RoleMetricSnapshot, 'role'>>> | undefined {
  if (!snapshots || snapshots.length === 0) return undefined;

  const result: Record<string, Omit<RoleMetricSnapshot, 'role'>> = {};

  for (const snapshot of snapshots) {
    result[snapshot.role] = {
      metrics: snapshot.metrics,
      subscriptionState: snapshot.subscriptionState,
    };
  }

  return result;
}
