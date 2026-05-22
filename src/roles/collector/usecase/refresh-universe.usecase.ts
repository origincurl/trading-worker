import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { COLLECTOR_CONFIG, type CollectorConfig } from '@config/collector.config';
import { COLLECTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type {
  BrokerageVendor,
  MarketDataFrameKind,
} from '@external/brokerage/vendor/brokerage.vendor';
import { REDIS_CLIENT, type RedisClientToken } from '@shared/cache/redis.module';
import type { ObservedSymbolModel } from '@shared/model/universe/observed-symbol.model';
import { CollectorShardAssignmentService } from '@roles/collector/service/collector-shard-assignment.service';
import { UniverseService } from '@roles/collector/service/universe.service';
import { SubscriptionPlannerService } from '@roles/collector/service/subscription-planner.service';

// FE-observation refcnt HASH keys. BE WS gateway maintains them (HINCRBY on
// subscribe / HDEL on count→0). Worker reads HKEYS — values are
// reference counts, not used here.
const FE_OBSERVATION_STOCKS_HASH = 'fe:observation:stocks:refcnt';
const FE_OBSERVATION_ETFS_HASH = 'fe:observation:etfs:refcnt';

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
  readonly desiredCount: number;
  readonly actualRequestedCount: number;
  readonly actualEffectiveCount: number;
  readonly desiredSample: readonly string[];
  // Worker-local requested set after REG/REMOVE send completion. This is not broker-confirmed.
  readonly actualRequestedSample: readonly string[];
  // Frame-backed coverage: requested symbols that emitted a frame inside effectiveWindowMs.
  readonly actualEffectiveSample: readonly string[];
  readonly drift: SubscriptionDriftSnapshot;
  readonly lastReconcileAt: string | null;
  readonly lastHintAt: string | null;
  readonly effectiveWindowMs: number;
  readonly effectiveState: 'warming_up' | 'ready';
  readonly effectiveWarmupUntil: string;
  readonly activeCollectorCount: number;
  readonly activeCollectors: readonly string[];
  readonly shardLeaseStatus: 'not_configured' | 'configured';
  readonly takeoverEvents: readonly string[];
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

  private actualSymbols: readonly string[] = [];

  private assignedSymbols: readonly string[] = [];

  private activeCollectors: readonly string[] = [];

  private shardLeaseStatus: 'not_configured' | 'configured' = 'not_configured';

  private takeoverEvents: readonly string[] = [];

  private readonly lastFrameAtBySymbol = new Map<string, number>();

  constructor(
    @Inject(COLLECTOR_CONFIG) private readonly collectorConfig: CollectorConfig,
    @Inject(COLLECTOR_BROKERAGE_VENDOR) private readonly gateway: BrokerageVendor,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: RedisClientToken,
    private readonly universe: UniverseService,
    private readonly assignment: CollectorShardAssignmentService,
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
    const assigned = normalizeSymbols(this.assignedSymbols);
    const actualRequested = normalizeSymbols(this.actualSymbols);
    const actualEffective = this.effectiveSymbols();
    const desiredNotRequested = difference(desired, actualRequested);
    const requestedNotDesired = difference(actualRequested, desired);
    const requestedNotEffective = difference(actualRequested, actualEffective);
    const effectiveNotRequested = difference(actualEffective, actualRequested);

    return {
      assignedCount: assigned.length,
      assignedSample: sample(assigned),
      desiredCount: desired.length,
      actualRequestedCount: actualRequested.length,
      actualEffectiveCount: actualEffective.length,
      desiredSample: sample(desired),
      actualRequestedSample: sample(actualRequested),
      actualEffectiveSample: sample(actualEffective),
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
      shardLeaseStatus: this.shardLeaseStatus,
      takeoverEvents: [...this.takeoverEvents],
    };
  }

  async execute(): Promise<void> {
    this._lastRefreshAt = new Date();

    let feSymbols: ObservedSymbolModel[];

    try {
      feSymbols = await this.readFeObservedSymbols();
    } catch (err) {
      this._lastRefreshOk = false;

      this.logger.warn(
        `observed-symbols fetch failed: ${err instanceof Error ? err.message : err}`,
      );

      return;
    }

    const desiredUniverse = this.universe.apply([], [], feSymbols);

    this._lastRefreshOk = true;

    const globalTarget = desiredUniverse.map((symbol) => symbol.symbol);
    const assignment = await this.assignment.assign(globalTarget);
    const target = [...assignment.assignedSymbols];

    this.universe.applyAssigned(target);

    this.desiredSymbols = [...target];

    this.assignedSymbols = [...target];

    this.activeCollectors = [...assignment.activeCollectors];

    this.shardLeaseStatus = assignment.leaseStatus;

    this.takeoverEvents = [...assignment.takeoverEvents];

    if (!this.gateway.isMarketDataStreamConnected()) {
      this.logger.warn('gateway not connected — universe REG deferred');

      return;
    }

    const kinds: MarketDataFrameKind[] = ['trade-tick'];

    if (this.collectorConfig.subscribeOrderbook) kinds.push('orderbook');

    const plan = this.planner.plan(this.actualSymbols, target);

    if (plan.remove.length > 0) {
      await this.gateway.unsubscribeMarketData({ symbols: [...plan.remove], kinds });
    }

    if (plan.add.length > 0) {
      await this.gateway.subscribeMarketData({ symbols: [...plan.add], kinds });
    }

    this.actualSymbols = [...target];

    this._lastReconcileAt = new Date();

    if (plan.add.length > 0 || plan.remove.length > 0) {
      this.logger.log(
        `universe reconcile desired=${target.length} add=${plan.add.length} remove=${plan.remove.length} kinds=[${kinds.join(',')}]`,
      );
    }
  }

  private async readFeObservedSymbols(): Promise<ObservedSymbolModel[]> {
    if (!this.redis) return [];

    try {
      const [stockKeys, etfKeys] = await Promise.all([
        this.redis.hkeys(FE_OBSERVATION_STOCKS_HASH),
        this.redis.hkeys(FE_OBSERVATION_ETFS_HASH),
      ]);

      return [
        ...(Array.isArray(stockKeys) ? stockKeys : []).map((symbol) => ({
          symbol,
          source: 'FE' as const,
          instrumentType: 'STOCK' as const,
        })),
        ...(Array.isArray(etfKeys) ? etfKeys : []).map((symbol) => ({
          symbol,
          source: 'FE' as const,
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
