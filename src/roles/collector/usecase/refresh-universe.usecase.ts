import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { COLLECTOR_CONFIG, type CollectorConfig } from '@config/collector.config';
import { COLLECTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type {
  BrokerageVendor,
  MarketDataFrameKind,
  SubscribeMarketDataInput,
} from '@external/brokerage/vendor/brokerage.vendor';
import { REDIS_CLIENT, type RedisClientToken } from '@shared/cache/redis.module';
import type { ObservedSymbolModel } from '@shared/model/universe/observed-symbol.model';
import { CollectorShardAssignmentService } from '@roles/collector/service/collector-shard-assignment.service';
import { StrategyDemandService } from '@roles/collector/service/strategy-demand.service';
import { UniverseService } from '@roles/collector/service/universe.service';
import { SubscriptionPlannerService } from '@roles/collector/service/subscription-planner.service';

type RebalanceCapableBrokerageVendor = BrokerageVendor & {
  rebalanceMarketData(input: SubscribeMarketDataInput): Promise<void>;
};

type ReconnectCapableBrokerageVendor = BrokerageVendor & {
  reconnectMarketDataStream(): Promise<void>;
};

type CapDroppedCapableBrokerageVendor = BrokerageVendor & {
  marketDataCapDroppedSymbols(): readonly string[];
};

// FE-observation lease keys. New BE chart streams create one short-lived key
// per active subscription so abnormal exits self-heal. Legacy refcount HASH
// keys are accepted only when they have a TTL; TTL-less hashes are treated as
// stale leftovers because they cannot self-heal after abnormal browser exits.
const FE_OBSERVATION_STOCKS_LEASE_PATTERN = 'fe:observation:stocks:lease:*';
const FE_OBSERVATION_ETFS_LEASE_PATTERN = 'fe:observation:etfs:lease:*';
const FE_OBSERVATION_STOCKS_HASH = 'fe:observation:stocks:refcnt';
const FE_OBSERVATION_ETFS_HASH = 'fe:observation:etfs:refcnt';
const FE_OBSERVATION_SCAN_COUNT = 100;
const LEGACY_OBSERVATION_HASH_NO_TTL = -1;

export interface SubscriptionDriftSnapshot {
  readonly desiredNotRequestedCount: number;
  readonly requestedNotDesiredCount: number;
  readonly requestedNotEffectiveCount: number;
  readonly effectiveNotRequestedCount: number;
  readonly desiredNotRequestedSample: readonly string[];
  readonly requestedNotDesiredSample: readonly string[];
  readonly requestedNotEffectiveSample: readonly string[];
  readonly effectiveNotRequestedSample: readonly string[];
}

export interface SubscriptionStateSnapshot {
  // Current worker-owned assignment set. Before multi-collector sharding this equals desiredSymbols.
  readonly assignedCount: number;
  readonly assignedSample: readonly string[];
  readonly globalDesiredCount: number;
  readonly globalDesiredSample: readonly string[];
  readonly chartDesiredCount: number;
  readonly strategyDesiredCount: number;
  readonly desiredCount: number;
  readonly actualRequestedCount: number;
  readonly actualEffectiveCount: number;
  readonly capDroppedCount: number;
  readonly desiredSample: readonly string[];
  // Worker-local requested set after REG/REMOVE send completion. This is not broker-confirmed.
  readonly actualRequestedSample: readonly string[];
  // Frame-backed coverage: requested symbols that emitted a frame inside effectiveWindowMs.
  readonly actualEffectiveSample: readonly string[];
  readonly capDroppedSample: readonly string[];
  readonly drift: SubscriptionDriftSnapshot;
  readonly lastReconcileAt: string | null;
  readonly lastHintAt: string | null;
  readonly effectiveWindowMs: number;
  readonly effectiveState: 'warming_up' | 'ready';
  readonly effectiveWarmupUntil: string;
  readonly activeCollectorCount: number;
  readonly activeCollectors: readonly string[];
  readonly collectorHeartbeats: readonly {
    readonly instanceId: string;
    readonly lastBeatAt: string | null;
    readonly ageMs: number | null;
  }[];
  readonly shardLeaseStatus: 'not_configured' | 'configured';
  readonly takeoverEvents: readonly string[];
  readonly heartbeatParseFailures: number;
  readonly heartbeatRoleMisses: number;
}

const EFFECTIVE_WINDOW_MS = 30_000;
const FRAME_RETENTION_MS = EFFECTIVE_WINDOW_MS * 10;
const SAMPLE_SIZE = 10;

// Pulls the live observation universe from Redis (FE-observed now; strategy
// demand joins this path in Phase 4) and re-applies it to the in-memory
// UniverseService. Admin watchlists do not directly subscribe broker WS.
// Failure on any fetch is tolerated — we keep the previous snapshot so a
// transient Redis hiccup never tears down vendor WS subscriptions.
@Injectable()
export class RefreshUniverseUsecase {
  private readonly logger = new Logger(RefreshUniverseUsecase.name);

  private readonly bootedAtMs = Date.now();

  private _lastRefreshAt: Date | null = null;

  private _lastRefreshOk = false;

  private _lastReconcileAt: Date | null = null;

  private _lastHintAt: Date | null = null;

  private desiredSymbols: readonly string[] = [];

  private globalDesiredSymbols: readonly string[] = [];

  private chartDesiredCount = 0;

  private strategyDesiredCount = 0;

  private actualSymbols: readonly string[] = [];

  private capDroppedSymbols: readonly string[] = [];

  private assignedSymbols: readonly string[] = [];

  private activeCollectors: readonly string[] = [];

  private collectorHeartbeats: SubscriptionStateSnapshot['collectorHeartbeats'] = [];

  private shardLeaseStatus: 'not_configured' | 'configured' = 'not_configured';

  private takeoverEvents: readonly string[] = [];

  private heartbeatParseFailures = 0;

  private heartbeatRoleMisses = 0;

  private readonly lastFrameAtBySymbol = new Map<string, number>();

  private readonly ignoredLegacyObservationKeys = new Set<string>();

  constructor(
    @Inject(COLLECTOR_CONFIG) private readonly collectorConfig: CollectorConfig,
    @Inject(COLLECTOR_BROKERAGE_VENDOR) private readonly gateway: BrokerageVendor,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: RedisClientToken,
    private readonly universe: UniverseService,
    private readonly assignment: CollectorShardAssignmentService,
    private readonly strategyDemand: StrategyDemandService,
    private readonly planner: SubscriptionPlannerService,
  ) {}

  lastRefreshAt(): Date | null {
    return this._lastRefreshAt;
  }

  lastRefreshOk(): boolean {
    return this._lastRefreshOk;
  }

  actualSubscriptionCount(): number {
    return this.actualSymbols.length;
  }

  recordHintReceived(at = new Date()): void {
    this._lastHintAt = at;
  }

  recordFrameReceived(symbol: string, at = new Date()): void {
    const normalized = symbol.trim();

    if (!normalized) return;

    this.lastFrameAtBySymbol.set(normalized, at.getTime());
  }

  subscriptionState(): SubscriptionStateSnapshot {
    this.pruneLastFrameEntries();

    const desired = normalizeSymbols(this.desiredSymbols);
    const globalDesired = normalizeSymbols(this.globalDesiredSymbols);
    const assigned = normalizeSymbols(this.assignedSymbols);
    const actualRequested = normalizeSymbols(this.actualSymbols);
    const actualEffective = this.effectiveSymbols();
    const capDropped = normalizeSymbols(this.capDroppedSymbols);
    const requestedOrCapBlocked = normalizeSymbols([...actualRequested, ...capDropped]);
    const desiredNotRequested = difference(desired, requestedOrCapBlocked);
    const requestedNotDesired = difference(actualRequested, desired);
    const requestedNotEffective = difference(actualRequested, actualEffective);
    const effectiveNotRequested = difference(actualEffective, actualRequested);

    return {
      assignedCount: assigned.length,
      assignedSample: sample(assigned),
      globalDesiredCount: globalDesired.length,
      globalDesiredSample: sample(globalDesired),
      chartDesiredCount: this.chartDesiredCount,
      strategyDesiredCount: this.strategyDesiredCount,
      desiredCount: desired.length,
      actualRequestedCount: actualRequested.length,
      actualEffectiveCount: actualEffective.length,
      capDroppedCount: capDropped.length,
      desiredSample: sample(desired),
      actualRequestedSample: sample(actualRequested),
      actualEffectiveSample: sample(actualEffective),
      capDroppedSample: sample(capDropped),
      drift: {
        desiredNotRequestedCount: desiredNotRequested.length,
        requestedNotDesiredCount: requestedNotDesired.length,
        requestedNotEffectiveCount: requestedNotEffective.length,
        effectiveNotRequestedCount: effectiveNotRequested.length,
        desiredNotRequestedSample: sample(desiredNotRequested),
        requestedNotDesiredSample: sample(requestedNotDesired),
        requestedNotEffectiveSample: sample(requestedNotEffective),
        effectiveNotRequestedSample: sample(effectiveNotRequested),
      },
      lastReconcileAt: this._lastReconcileAt?.toISOString() ?? null,
      lastHintAt: this._lastHintAt?.toISOString() ?? null,
      effectiveWindowMs: EFFECTIVE_WINDOW_MS,
      effectiveState: this.effectiveState(),
      effectiveWarmupUntil: new Date(this.bootedAtMs + EFFECTIVE_WINDOW_MS).toISOString(),
      activeCollectorCount: this.activeCollectors.length,
      activeCollectors: [...this.activeCollectors],
      collectorHeartbeats: [...this.collectorHeartbeats],
      shardLeaseStatus: this.shardLeaseStatus,
      takeoverEvents: [...this.takeoverEvents],
      heartbeatParseFailures: this.heartbeatParseFailures,
      heartbeatRoleMisses: this.heartbeatRoleMisses,
    };
  }

  async execute(): Promise<void> {
    this._lastRefreshAt = new Date();

    let chartSymbols: ObservedSymbolModel[];
    let strategySymbols: ObservedSymbolModel[];

    try {
      [chartSymbols, strategySymbols] = await Promise.all([
        this.readChartObservedSymbols(),
        this.strategyDemand.activeSymbols(),
      ]);
    } catch (err) {
      this._lastRefreshOk = false;

      this.logger.warn(
        `observed-symbols fetch failed: ${err instanceof Error ? err.message : err}`,
      );

      return;
    }

    const desiredUniverse = this.universe.normalizeDemand(chartSymbols, strategySymbols);

    this._lastRefreshOk = true;

    const globalTarget = desiredUniverse.map((symbol) => symbol.symbol);
    const assignment = await this.assignment.assign(globalTarget);
    const target = [...assignment.assignedSymbols];

    this.universe.applyAssignedSnapshot(chartSymbols, strategySymbols, target);

    this.desiredSymbols = [...target];

    this.globalDesiredSymbols = [...globalTarget];

    this.chartDesiredCount = this.universe.observedFeCount();

    this.strategyDesiredCount = this.universe.strategyDemandCount();

    this.assignedSymbols = [...target];

    this.activeCollectors = [...assignment.activeCollectors];

    this.collectorHeartbeats = [...assignment.collectorHeartbeats];

    this.shardLeaseStatus = assignment.leaseStatus;

    this.takeoverEvents = [...assignment.takeoverEvents];

    this.heartbeatParseFailures = assignment.heartbeatParseFailures;

    this.heartbeatRoleMisses = assignment.heartbeatRoleMisses;

    if (!this.gateway.isMarketDataStreamConnected()) {
      const reconnector = marketDataReconnector(this.gateway);

      if (!reconnector) {
        this.logger.warn('gateway not connected — universe REG deferred');

        return;
      }

      try {
        await reconnector.reconnectMarketDataStream();
      } catch (err) {
        this.logger.warn(
          `gateway reconnect failed — universe REG deferred: ${
            err instanceof Error ? err.message : err
          }`,
        );

        return;
      }
    }

    const kinds: MarketDataFrameKind[] = ['trade-tick'];

    if (this.collectorConfig.subscribeOrderbook) kinds.push('orderbook');

    const plan = this.planner.plan(this.actualSymbols, target);
    const rebalancer = marketDataRebalancer(this.gateway);

    if (rebalancer) {
      await rebalancer.rebalanceMarketData({ symbols: target, kinds });
    } else {
      if (plan.remove.length > 0) {
        await this.gateway.unsubscribeMarketData({ symbols: [...plan.remove], kinds });
      }

      if (plan.add.length > 0) {
        await this.gateway.subscribeMarketData({ symbols: [...plan.add], kinds });
      }
    }

    this.capDroppedSymbols = normalizeSymbols(capDroppedSymbols(this.gateway)).filter((symbol) =>
      target.includes(symbol),
    );
    this.actualSymbols = difference(target, this.capDroppedSymbols);

    this._lastReconcileAt = new Date();

    if (plan.add.length > 0 || plan.remove.length > 0 || this.capDroppedSymbols.length > 0) {
      this.logger.log(
        `universe reconcile desired=${target.length} requested=${this.actualSymbols.length} capDropped=${this.capDroppedSymbols.length} add=${plan.add.length} remove=${plan.remove.length} kinds=[${kinds.join(',')}]`,
      );
    }
  }

  private async readChartObservedSymbols(): Promise<ObservedSymbolModel[]> {
    if (!this.redis) return [];

    try {
      const [stockLeaseSymbols, etfLeaseSymbols] = await Promise.all([
        this.readLeaseSymbols(FE_OBSERVATION_STOCKS_LEASE_PATTERN),
        this.readLeaseSymbols(FE_OBSERVATION_ETFS_LEASE_PATTERN),
      ]);

      const [stockKeys, etfKeys] = await Promise.all([
        this.readLegacyObservedSymbols(FE_OBSERVATION_STOCKS_HASH),
        this.readLegacyObservedSymbols(FE_OBSERVATION_ETFS_HASH),
      ]);

      return [
        ...stockLeaseSymbols.map((symbol) => ({
          symbol,
          source: 'CHART' as const,
          instrumentType: 'STOCK' as const,
        })),
        ...etfLeaseSymbols.map((symbol) => ({
          symbol,
          source: 'CHART' as const,
          instrumentType: 'ETF' as const,
        })),
        ...stockKeys.map((symbol) => ({
          symbol,
          source: 'CHART' as const,
          instrumentType: 'STOCK' as const,
        })),
        ...etfKeys.map((symbol) => ({
          symbol,
          source: 'CHART' as const,
          instrumentType: 'ETF' as const,
        })),
      ];
    } catch (err) {
      this.logger.warn(
        `redis hkeys FE observation failed: ${err instanceof Error ? err.message : err}`,
      );

      return [];
    }
  }

  private async readLegacyObservedSymbols(key: string): Promise<string[]> {
    if (!this.redis) return [];

    const ttl = await this.redis.ttl(key);
    if (ttl === LEGACY_OBSERVATION_HASH_NO_TTL) {
      if (!this.ignoredLegacyObservationKeys.has(key)) {
        this.ignoredLegacyObservationKeys.add(key);
        this.logger.warn(`ignoring legacy FE observation hash without TTL key=${key}`);
      }

      return [];
    }

    return await this.redis.hkeys(key);
  }

  private async readLeaseSymbols(pattern: string): Promise<string[]> {
    if (!this.redis) return [];

    const keys = await scanAll(this.redis, pattern, FE_OBSERVATION_SCAN_COUNT);
    if (keys.length === 0) return [];

    const values = await this.redis.mget(...keys);

    return values
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value): value is string => value.length > 0)
      .sort();
  }

  private effectiveSymbols(): string[] {
    const cutoff = Date.now() - EFFECTIVE_WINDOW_MS;

    return Array.from(this.lastFrameAtBySymbol.entries())
      .filter(([, timestamp]) => timestamp >= cutoff)
      .map(([symbol]) => symbol)
      .sort();
  }

  private pruneLastFrameEntries(now = Date.now()): void {
    const cutoff = now - FRAME_RETENTION_MS;

    for (const [symbol, timestamp] of this.lastFrameAtBySymbol) {
      if (timestamp < cutoff) this.lastFrameAtBySymbol.delete(symbol);
    }
  }

  private effectiveState(): SubscriptionStateSnapshot['effectiveState'] {
    return Date.now() < this.bootedAtMs + EFFECTIVE_WINDOW_MS ? 'warming_up' : 'ready';
  }
}

function normalizeSymbols(symbols: readonly string[]): string[] {
  return Array.from(new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean))).sort();
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);

  return left.filter((symbol) => !rightSet.has(symbol));
}

function sample(symbols: readonly string[]): string[] {
  return symbols.slice(0, SAMPLE_SIZE);
}

function marketDataRebalancer(
  gateway: BrokerageVendor,
): RebalanceCapableBrokerageVendor | null {
  const maybe = gateway as Partial<RebalanceCapableBrokerageVendor>;

  return typeof maybe.rebalanceMarketData === 'function'
    ? (gateway as RebalanceCapableBrokerageVendor)
    : null;
}

function marketDataReconnector(
  gateway: BrokerageVendor,
): ReconnectCapableBrokerageVendor | null {
  const maybe = gateway as Partial<ReconnectCapableBrokerageVendor>;

  return typeof maybe.reconnectMarketDataStream === 'function'
    ? (gateway as ReconnectCapableBrokerageVendor)
    : null;
}

function capDroppedSymbols(gateway: BrokerageVendor): readonly string[] {
  const maybe = gateway as Partial<CapDroppedCapableBrokerageVendor>;

  return typeof maybe.marketDataCapDroppedSymbols === 'function'
    ? maybe.marketDataCapDroppedSymbols()
    : [];
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
