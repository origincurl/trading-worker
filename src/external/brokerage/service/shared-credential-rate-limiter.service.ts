import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import { REDIS_CLIENT, type RedisClientToken } from '@shared/cache/redis.module';
import { RateLimitExceededError } from '@common/error/domain.error';
import type {
  CredentialUsageActionType,
  CredentialUsageOrigin,
  CredentialUsagePriority,
} from '../credential/credential-usage.service';

export interface SharedCredentialRateLimitInput {
  readonly credentialId: number;
  readonly endpointType: string;
  readonly origin: CredentialUsageOrigin;
  readonly priority: CredentialUsagePriority;
  readonly actionType: CredentialUsageActionType;
  readonly capacity: number;
  readonly refillPerSecond: number;
  readonly maxConcurrent: number;
}

export interface SharedCredentialRateLimitLease {
  readonly key: string;
  readonly ownerId: string;
  release(): Promise<void>;
}

const ACQUIRE_SCRIPT = `
local tokenKey = KEYS[1]
local inflightKey = KEYS[2]
local capacity = tonumber(ARGV[1])
local refillPerSecond = tonumber(ARGV[2])
local maxConcurrent = tonumber(ARGV[3])
local nowMs = tonumber(ARGV[4])
local ttlMs = tonumber(ARGV[5])
local ownerId = ARGV[6]
local expiresAtMs = nowMs + ttlMs

local inflightTotal = 0
local inflightRows = redis.call('HGETALL', inflightKey)
for i = 1, #inflightRows, 2 do
  local field = inflightRows[i]
  local expiresAt = tonumber(inflightRows[i + 1])
  if expiresAt == nil or expiresAt <= nowMs then
    redis.call('HDEL', inflightKey, field)
  else
    inflightTotal = inflightTotal + 1
  end
end

if maxConcurrent > 0 and inflightTotal >= maxConcurrent then
  return {0, 'concurrency', inflightTotal}
end

local tokens = tonumber(redis.call('HGET', tokenKey, 'tokens'))
local updatedAt = tonumber(redis.call('HGET', tokenKey, 'updatedAt'))
if tokens == nil then tokens = capacity end
if updatedAt == nil then updatedAt = nowMs end

local elapsedMs = math.max(0, nowMs - updatedAt)
tokens = math.min(capacity, tokens + (elapsedMs / 1000) * refillPerSecond)

if tokens < 1 then
  redis.call('HSET', tokenKey, 'tokens', tokens, 'updatedAt', nowMs)
  redis.call('PEXPIRE', tokenKey, ttlMs)
  return {0, 'tokens', inflightTotal}
end

tokens = tokens - 1
redis.call('HSET', tokenKey, 'tokens', tokens, 'updatedAt', nowMs)
redis.call('PEXPIRE', tokenKey, ttlMs)
redis.call('HSET', inflightKey, ownerId, expiresAtMs)
redis.call('PEXPIRE', inflightKey, ttlMs)
return {1, 'granted', inflightTotal + 1}
`;

const RELEASE_SCRIPT = `
local inflightKey = KEYS[1]
local ownerId = ARGV[1]
local ttlMs = tonumber(ARGV[2])

local removed = redis.call('HDEL', inflightKey, ownerId)

if redis.call('HLEN', inflightKey) > 0 then
  redis.call('PEXPIRE', inflightKey, ttlMs)
else
  redis.call('DEL', inflightKey)
end

return removed
`;

@Injectable()
export class SharedCredentialRateLimiter {
  private readonly logger = new Logger(SharedCredentialRateLimiter.name);

  private readonly enabled = isEnabled(process.env.WORKER_SHARED_RATE_LIMIT_ENABLED);

  private sequence = 0;

  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: RedisClientToken,
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
  ) {}

  isEnabled(): boolean {
    return this.enabled && Boolean(this.redis);
  }

  async acquire(input: SharedCredentialRateLimitInput): Promise<SharedCredentialRateLimitLease | null> {
    if (!this.isEnabled() || !this.redis) return null;

    const key = this.key(input);
    const ownerId = `${this.runtime.workerInstanceId}:${process.pid}:${Date.now()}:${++this.sequence}`;
    const ttlMs = this.leaseTtlMs();
    const result = await this.redis.eval(
      ACQUIRE_SCRIPT,
      2,
      `${key}:tokens`,
      `${key}:inflight`,
      input.capacity,
      input.refillPerSecond,
      input.maxConcurrent,
      Date.now(),
      ttlMs,
      ownerId,
    );
    const parsed = Array.isArray(result) ? result : [];
    const granted = Number(parsed[0]) === 1;

    if (!granted) {
      const reason = String(parsed[1] ?? 'unknown');
      throw new RateLimitExceededError(`shared credential rate-limit rejected by ${reason}`, {
        limiter: key,
        kind: reason,
        priority: input.priority,
        origin: input.origin,
        actionType: input.actionType,
      });
    }

    return {
      key,
      ownerId,
      release: async () => {
        await this.release(key, ownerId, ttlMs);
      },
    };
  }

  private async release(key: string, ownerId: string, ttlMs: number): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.eval(RELEASE_SCRIPT, 1, `${key}:inflight`, ownerId, ttlMs);
    } catch (err) {
      this.logger.warn(
        `shared credential rate-limit release failed key=${key}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private key(input: SharedCredentialRateLimitInput): string {
    const marketEnv = safeSegment(this.kiwoom.marketEnv);
    const endpointType = safeSegment(input.endpointType);

    return `rl:{cred:${marketEnv}:${input.credentialId}}:${endpointType}`;
  }

  private leaseTtlMs(): number {
    const raw = Number(process.env.WORKER_SHARED_RATE_LIMIT_LEASE_TTL_MS ?? '');

    return Number.isFinite(raw) && raw >= 1000 ? Math.floor(raw) : 30_000;
  }
}

function isEnabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

function safeSegment(value: string): string {
  const normalized = value.trim() || 'unknown';

  return normalized.replace(/[^A-Za-z0-9._-]/g, '_');
}
