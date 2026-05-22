import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import { REDIS_CLIENT, type RedisClientToken } from '@shared/cache/redis.module';
import { RedisKeyBuilder } from '@shared/cache/redis-key.builder';

const HEARTBEAT_SCAN_COUNT = 100;

export interface CollectorShardAssignment {
  readonly assignedSymbols: readonly string[];
  readonly globalDesiredCount: number;
  readonly globalDesiredSample: readonly string[];
  readonly activeCollectors: readonly string[];
  readonly collectorHeartbeats: readonly CollectorHeartbeatSnapshot[];
  readonly ownerBySymbol: Readonly<Record<string, string>>;
  readonly leaseStatus: 'not_configured' | 'configured';
  readonly takeoverEvents: readonly string[];
  readonly heartbeatParseFailures: number;
  readonly heartbeatRoleMisses: number;
}

export interface CollectorHeartbeatSnapshot {
  readonly instanceId: string;
  readonly lastBeatAt: string | null;
  readonly ageMs: number | null;
}

@Injectable()
export class CollectorShardAssignmentService {
  private readonly logger = new Logger(CollectorShardAssignmentService.name);

  private lastOwnerBySymbol = new Map<string, string>();

  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: RedisClientToken,
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    private readonly keys: RedisKeyBuilder,
  ) {}

  async assign(symbols: readonly string[]): Promise<CollectorShardAssignment> {
    const normalized = normalizeSymbols(symbols);
    const membership = await this.activeCollectorMembership();
    const activeCollectors = membership.collectorIds;
    const ownerBySymbol = new Map<string, string>();

    for (const symbol of normalized) {
      ownerBySymbol.set(symbol, ownerFor(symbol, activeCollectors));
    }

    const assignedSymbols = normalized.filter(
      (symbol) => ownerBySymbol.get(symbol) === this.runtime.workerInstanceId,
    );
    const takeoverEvents = this.takeoverEvents(ownerBySymbol);

    this.lastOwnerBySymbol = ownerBySymbol;

    if (takeoverEvents.length > 0) {
      this.logger.warn(`collector shard takeover detected: ${takeoverEvents.join(', ')}`);
    }

    return {
      assignedSymbols,
      globalDesiredCount: normalized.length,
      globalDesiredSample: normalized.slice(0, 10),
      activeCollectors,
      collectorHeartbeats: membership.heartbeats,
      ownerBySymbol: Object.fromEntries(ownerBySymbol),
      leaseStatus: activeCollectors.length > 1 ? 'configured' : 'not_configured',
      takeoverEvents,
      heartbeatParseFailures: membership.parseFailures,
      heartbeatRoleMisses: membership.roleMisses,
    };
  }

  private async activeCollectorMembership(): Promise<{
    readonly collectorIds: string[];
    readonly heartbeats: readonly CollectorHeartbeatSnapshot[];
    readonly parseFailures: number;
    readonly roleMisses: number;
  }> {
    const selfHeartbeat: CollectorHeartbeatSnapshot = {
      instanceId: this.runtime.workerInstanceId,
      lastBeatAt: null,
      ageMs: null,
    };
    const fallback = {
      collectorIds: [this.runtime.workerInstanceId],
      heartbeats: [selfHeartbeat],
      parseFailures: 0,
      roleMisses: 0,
    };
    if (!this.redis) return fallback;

    try {
      const heartbeatPattern = this.keys.pattern('heartbeat', '*');
      const keys = await scanAll(this.redis, heartbeatPattern, HEARTBEAT_SCAN_COUNT);
      const values = keys.length > 0 ? await this.redis.mget(...keys) : [];
      const ids = new Set<string>([this.runtime.workerInstanceId]);
      const heartbeatById = new Map<string, CollectorHeartbeatSnapshot>([
        [this.runtime.workerInstanceId, selfHeartbeat],
      ]);
      let parseFailures = 0;
      let roleMisses = 0;

      for (let i = 0; i < keys.length; i += 1) {
        const payload = parseJson(values[i]);
        const instanceId = keys[i].split(':').at(-1);
        if (!instanceId) continue;

        if (!payload) {
          parseFailures += 1;
          continue;
        }

        if (!Array.isArray(payload.roles) || !payload.roles.includes('collector')) {
          roleMisses += 1;
          continue;
        }

        ids.add(instanceId);

        heartbeatById.set(instanceId, {
          instanceId,
          lastBeatAt: typeof payload.ts === 'string' ? payload.ts : null,
          ageMs: typeof payload.ts === 'string' ? heartbeatAgeMs(payload.ts) : null,
        });
      }

      if (parseFailures > 0 || roleMisses > 0) {
        this.logger.warn(
          `collector shard heartbeat parse issues: parseFailures=${parseFailures} roleMisses=${roleMisses}`,
        );
      }

      return {
        collectorIds: Array.from(ids).sort(),
        heartbeats: Array.from(heartbeatById.values()).sort((a, b) =>
          a.instanceId.localeCompare(b.instanceId),
        ),
        parseFailures,
        roleMisses,
      };
    } catch (err) {
      this.logger.warn(
        `collector shard heartbeat scan failed: ${err instanceof Error ? err.message : String(err)}`,
      );

      return fallback;
    }
  }

  private takeoverEvents(ownerBySymbol: Map<string, string>): string[] {
    const events: string[] = [];

    for (const [symbol, owner] of ownerBySymbol) {
      const previous = this.lastOwnerBySymbol.get(symbol);
      if (previous && previous !== owner) {
        events.push(`${symbol}:${previous}->${owner}`);
      }
    }

    return events.slice(0, 10);
  }
}

async function scanAll(
  redis: NonNullable<RedisClientToken>,
  pattern: string,
  count: number,
): Promise<string[]> {
  let cursor = '0';
  const keys: string[] = [];

  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', count);

    cursor = nextCursor;

    keys.push(...batch);
  } while (cursor !== '0');

  return keys.sort();
}

function ownerFor(symbol: string, activeCollectors: readonly string[]): string {
  let best = activeCollectors[0];
  let bestScore = -1;

  for (const collector of activeCollectors) {
    const score = fnv1a32(`${symbol}:${collector}`);
    if (score > bestScore) {
      best = collector;

      bestScore = score;
    }
  }

  return best;
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);

    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }

  return hash >>> 0;
}

function normalizeSymbols(symbols: readonly string[]): string[] {
  return Array.from(new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean))).sort();
}

function heartbeatAgeMs(value: string): number | null {
  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : null;
}

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;

    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
