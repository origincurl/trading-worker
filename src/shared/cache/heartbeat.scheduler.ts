import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { REDIS_CONFIG, type RedisConfig } from '@config/redis.config';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import {
  emptyRoleMetrics,
  ROLE_METRIC_TOKENS,
  ROLE_STATUS_TOKENS,
  type RoleMetricProvider,
  type RoleStatusProvider,
} from '@roles/role-status';
import { HeartbeatWriter, type RoleMetricSnapshot } from './heartbeat.writer';

@Injectable()
export class HeartbeatScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatScheduler.name);

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly warnedMissingMetricProviders = new Set<string>();
  private readonly warnedMissingStatusProviders = new Set<string>();

  constructor(
    private readonly writer: HeartbeatWriter,
    private readonly moduleRef: ModuleRef,
    @Inject(REDIS_CONFIG) private readonly redis: RedisConfig,
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.redis.heartbeatIntervalSec * 1000;

    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();

    void this.tick();

    this.logger.log(`scheduler worker.heartbeat every ${this.redis.heartbeatIntervalSec}s`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      await this.writer.tick(undefined, { roleMetrics: this.collectRoleMetrics() });
      this.logRoleStatus();
    } catch (err) {
      this.logger.warn(`worker heartbeat failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.running = false;
    }
  }

  private collectRoleMetrics(): RoleMetricSnapshot[] {
    return this.runtime.roles.map((role) => {
      const provider = this.getOptional<RoleMetricProvider>(ROLE_METRIC_TOKENS[role]);

      if (!provider) {
        this.warnMissingProvider('metric', role);

        return {
          ...emptyRoleMetrics(role),
          metrics: { provider_missing: true },
        };
      }

      return provider.getRoleMetrics();
    });
  }

  private logRoleStatus(): void {
    const details = this.runtime.roles.map((role) => {
      const provider = this.getOptional<RoleStatusProvider>(ROLE_STATUS_TOKENS[role]);

      if (!provider) {
        this.warnMissingProvider('status', role);

        return `${role}:missing_provider`;
      }

      const status = provider?.getStatus();

      return `${role}:${status?.ready === false ? 'not_ready' : 'ready'}${
        status?.detail ? `(${status.detail})` : ''
      }`;
    });

    this.logger.log(`worker heartbeat: ${details.join(' ')}`);
  }

  private getOptional<T>(token: symbol): T | undefined {
    try {
      return this.moduleRef.get<T>(token, { strict: false });
    } catch {
      return undefined;
    }
  }

  private warnMissingProvider(kind: 'metric' | 'status', role: string): void {
    const bucket =
      kind === 'metric' ? this.warnedMissingMetricProviders : this.warnedMissingStatusProviders;
    const key = `${kind}:${role}`;

    if (bucket.has(key)) return;

    bucket.add(key);
    this.logger.warn(`worker heartbeat ${kind} provider missing for active role=${role}`);
  }
}
