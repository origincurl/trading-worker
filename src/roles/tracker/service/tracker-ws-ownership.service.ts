import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { REDIS_CONFIG, type RedisConfig } from '@config/redis.config';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import { REDIS_CLIENT, type RedisClientToken } from '@shared/cache/redis.module';
import { TrackerTargetService } from './tracker-target.service';

export interface TrackerWsLeaseSnapshot {
  readonly credentialId: number;
  readonly key: string;
  readonly ownerId: string | null;
  readonly owned: boolean;
  readonly accountId: number;
  readonly accountCredentialId: number;
  readonly accountExternalId: string;
  readonly marketEnv: 'mock' | 'production';
}

const SCHEDULER_NAME = 'tracker.execution-ws-ownership';
const DEFAULT_LEASE_TTL_SEC = 30;
const DEFAULT_RENEW_INTERVAL_MS = 5_000;
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;
const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
end
return nil
`;

@Injectable()
export class TrackerWsOwnershipService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TrackerWsOwnershipService.name);

  private readonly ownerId: string;

  private readonly leaseTtlSec = readPositiveInt(
    process.env.TRACKER_WS_LEASE_TTL_SEC,
    DEFAULT_LEASE_TTL_SEC,
  );

  private readonly renewIntervalMs = readPositiveInt(
    process.env.TRACKER_WS_LEASE_RENEW_INTERVAL_MS,
    DEFAULT_RENEW_INTERVAL_MS,
  );

  private snapshots: TrackerWsLeaseSnapshot[] = [];

  constructor(
    private readonly targets: TrackerTargetService,
    private readonly registry: SchedulerRegistry,
    @Inject(REDIS_CONFIG) private readonly redisConfig: RedisConfig,
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: RedisClientToken,
  ) {
    this.ownerId = `${runtime.workerInstanceId}:${process.pid}`;
  }

  onApplicationBootstrap(): void {
    if (this.registry.doesExist('interval', SCHEDULER_NAME)) return;

    void this.refresh().catch((err) => this.warnRefresh(err));

    const handle = setInterval(() => {
      this.refresh().catch((err) => this.warnRefresh(err));
    }, this.renewIntervalMs);

    this.registry.addInterval(SCHEDULER_NAME, handle);
    this.logger.log(
      `tracker execution WS ownership refreshing every ${this.renewIntervalMs}ms ttl=${this.leaseTtlSec}s`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.registry.doesExist('interval', SCHEDULER_NAME)) {
      this.registry.deleteInterval(SCHEDULER_NAME);
    }

    if (!this.redis) return;

    await Promise.all(
      this.snapshots
        .filter((item) => item.owned)
        .map((item) => this.redis?.eval(RELEASE_SCRIPT, 1, item.key, this.ownerId).catch(() => 0)),
    );
  }

  snapshot(): TrackerWsLeaseSnapshot[] {
    return this.snapshots;
  }

  ownedCredentialIds(): number[] {
    return this.snapshots
      .filter((item) => item.owned)
      .map((item) => item.credentialId)
      .sort((a, b) => a - b);
  }

  private async refresh(): Promise<void> {
    const targets = await this.targets.activeCredentialTargets();

    if (!this.redis) {
      this.snapshots = targets.map((target) => ({
        credentialId: target.apiCredentialId,
        key: this.leaseKey(target.marketEnv, target.apiCredentialId),
        ownerId: null,
        owned: false,
        accountId: target.accountId,
        accountCredentialId: target.accountCredentialId,
        accountExternalId: target.accountExternalId,
        marketEnv: target.marketEnv,
      }));

      return;
    }

    const next: TrackerWsLeaseSnapshot[] = [];

    for (const target of targets) {
      const key = this.leaseKey(target.marketEnv, target.apiCredentialId);
      const acquired = await this.redis.set(key, this.ownerId, 'EX', this.leaseTtlSec, 'NX');
      let ownerId = acquired === 'OK' ? this.ownerId : await this.redis.get(key);

      if (ownerId === this.ownerId) {
        const renewed = await this.redis.eval(RENEW_SCRIPT, 1, key, this.ownerId, this.leaseTtlSec);
        ownerId = renewed === 'OK' ? this.ownerId : await this.redis.get(key);
      }

      next.push({
        credentialId: target.apiCredentialId,
        key,
        ownerId,
        owned: ownerId === this.ownerId,
        accountId: target.accountId,
        accountCredentialId: target.accountCredentialId,
        accountExternalId: target.accountExternalId,
        marketEnv: target.marketEnv,
      });
    }

    this.snapshots = next;
  }

  private leaseKey(marketEnv: 'mock' | 'production', credentialId: number): string {
    return `${this.redisConfig.keyPrefix}:${marketEnv}:ws-owner:{cred:${credentialId}}`;
  }

  private warnRefresh(err: unknown): void {
    this.logger.warn(
      `tracker execution WS ownership refresh failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
