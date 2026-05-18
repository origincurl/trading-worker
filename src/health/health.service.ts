import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { PERSISTENCE_CONFIG, type PersistenceConfig } from '@config/persistence.config';
import { REDIS_CONFIG, type RedisConfig } from '@config/redis.config';
import { RUNTIME_CONFIG, type RuntimeConfig, type WorkerRole } from '@config/runtime.config';
import { REDIS_CLIENT, type RedisClientToken } from '@shared/cache/redis.module';
import { CredentialUsageService } from '@external/brokerage/credential/credential-usage.service';
import { ROLE_STATUS_TOKENS, type RoleStatusProvider } from '@roles/role-status';
import type {
  HealthResponseDto,
  LiveResponseDto,
  ReadyResponseDto,
  RoleStatusDto,
} from './dto/health.response.dto';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  private readonly startedAt = Date.now();

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    @Inject(PERSISTENCE_CONFIG) private readonly persistence: PersistenceConfig,
    @Inject(REDIS_CONFIG) private readonly redisConfig: RedisConfig,
    private readonly moduleRef: ModuleRef,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: RedisClientToken,
    @Optional()
    @InjectDataSource()
    private readonly dataSource?: DataSource,
    @Optional() private readonly credentialUsage?: CredentialUsageService,
  ) {}

  live(): LiveResponseDto {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  async ready(): Promise<ReadyResponseDto> {
    const db = await this.checkDb();
    const redis = await this.checkRedis();
    const roles = this.checkRoles();

    const states: ReadyResponseDto['checks'][keyof ReadyResponseDto['checks']][] = [
      db,
      redis,
      roles,
    ];

    const status: ReadyResponseDto['status'] = states.some((s) => s !== 'ok') ? 'degraded' : 'ok';

    return {
      status,
      checks: { db, redis, roles },
      timestamp: new Date().toISOString(),
    };
  }

  health(): HealthResponseDto {
    const shard =
      this.runtime.shardIndex !== undefined && this.runtime.shardCount !== undefined
        ? { index: this.runtime.shardIndex, count: this.runtime.shardCount }
        : undefined;

    return {
      status: 'ok',
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      workerInstanceId: this.runtime.workerInstanceId,
      activeRoles: this.runtime.roles,
      roleStatuses: this.collectRoleStatuses(),
      credentialUsage: this.credentialUsage?.snapshot(),
      shard,
      nodeEnv: this.runtime.nodeEnv,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDb(): Promise<ReadyResponseDto['checks']['db']> {
    if (!this.persistence.databaseUrl) return 'unconfigured';

    if (!this.dataSource?.isInitialized) return 'down';

    try {
      await this.dataSource.query('SELECT 1');

      return 'ok';
    } catch (err) {
      this.logger.warn(`DB ping failed: ${err instanceof Error ? err.message : err}`);

      return 'down';
    }
  }

  private async checkRedis(): Promise<ReadyResponseDto['checks']['redis']> {
    if (!this.redisConfig.url) return 'unconfigured';

    if (!this.redis) return 'down';

    // ioredis queues commands while the socket is reconnecting, so ping()
    // can hang indefinitely if Redis is down. Bound the probe so /ready
    // stays responsive for k8s.
    const pingTimeoutMs = 500;
    const ping = this.redis.ping();
    const timeout = new Promise<'TIMEOUT'>((resolve) =>
      setTimeout(() => resolve('TIMEOUT'), pingTimeoutMs),
    );

    try {
      const result = await Promise.race([ping, timeout]);

      return result === 'PONG' ? 'ok' : 'down';
    } catch (err) {
      this.logger.warn(`Redis ping failed: ${err instanceof Error ? err.message : err}`);

      return 'down';
    }
  }

  private checkRoles(): ReadyResponseDto['checks']['roles'] {
    if (this.runtime.roles.length === 0) return 'unconfigured';

    const statuses = this.collectRoleStatuses();

    if (statuses.length !== this.runtime.roles.length) return 'down';

    return statuses.every((s) => s.ready) ? 'ok' : 'down';
  }

  private collectRoleStatuses(): RoleStatusDto[] {
    return this.runtime.roles.map((role) => this.resolveRoleStatus(role));
  }

  // Role status services live in role-specific modules that are conditionally
  // imported by AppModule (per ROLES env). ModuleRef.get with strict=false
  // walks the full graph so we surface a missing provider as ready=false
  // rather than crashing the health probe.
  private resolveRoleStatus(role: WorkerRole): RoleStatusDto {
    const token = ROLE_STATUS_TOKENS[role];

    try {
      const provider = this.moduleRef.get<RoleStatusProvider>(token, { strict: false });
      const status = provider.getStatus();

      return { role: status.role, ready: status.ready, detail: status.detail };
    } catch {
      return {
        role,
        ready: false,
        detail: 'role status provider missing — module not loaded',
      };
    }
  }
}
