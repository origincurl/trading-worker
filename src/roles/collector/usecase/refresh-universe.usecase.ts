import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { COLLECTOR_CONFIG, type CollectorConfig } from '@config/collector.config';
import { COLLECTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type {
  BrokerageVendor,
  MarketDataFrameKind,
} from '@external/brokerage/vendor/brokerage.vendor';
import { REDIS_CLIENT, type RedisClientToken } from '@shared/cache/redis.module';
import type { ObservedSymbolModel } from '@shared/model/universe/observed-symbol.model';
import { UniverseService } from '@roles/collector/service/universe.service';
import { SubscriptionPlannerService } from '@roles/collector/service/subscription-planner.service';

// FE-observation refcnt HASH keys. BE WS gateway maintains them (HINCRBY on
// subscribe / HDEL on count→0). Worker reads HKEYS — values are
// reference counts, not used here.
const FE_OBSERVATION_STOCKS_HASH = 'fe:observation:stocks:refcnt';
const FE_OBSERVATION_ETFS_HASH = 'fe:observation:etfs:refcnt';

export interface SubscriptionDriftSnapshot {
  readonly desiredNotActual: readonly string[];
  readonly actualNotDesired: readonly string[];
}

export interface SubscriptionStateSnapshot {
  readonly desired: readonly string[];
  // Worker-local requested set after REG/REMOVE send completion. This is not
  // broker-confirmed; sharding should introduce an effective/frame-backed axis.
  readonly actual: readonly string[];
  readonly drift: SubscriptionDriftSnapshot;
  readonly lastReconcileAt: string | null;
  readonly lastHintAt: string | null;
}

// Pulls the live observation universe from Redis (FE-observed now; strategy
// demand joins this path in Phase 4) and re-applies it to the in-memory
// UniverseService. Admin watchlists do not directly subscribe broker WS.
// Failure on any fetch is tolerated — we keep the previous snapshot so a
// transient Redis hiccup never tears down vendor WS subscriptions.
@Injectable()
export class RefreshUniverseUsecase {
  private readonly logger = new Logger(RefreshUniverseUsecase.name);

  private _lastRefreshAt: Date | null = null;

  private _lastRefreshOk = false;

  private _lastReconcileAt: Date | null = null;

  private _lastHintAt: Date | null = null;

  private desiredSymbols: readonly string[] = [];

  private actualSymbols: readonly string[] = [];

  constructor(
    @Inject(COLLECTOR_CONFIG) private readonly collectorConfig: CollectorConfig,
    @Inject(COLLECTOR_BROKERAGE_VENDOR) private readonly gateway: BrokerageVendor,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: RedisClientToken,
    private readonly universe: UniverseService,
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

  subscriptionState(): SubscriptionStateSnapshot {
    const desired = normalizeSymbols(this.desiredSymbols);
    const actual = normalizeSymbols(this.actualSymbols);

    return {
      desired,
      actual,
      drift: {
        desiredNotActual: difference(desired, actual),
        actualNotDesired: difference(actual, desired),
      },
      lastReconcileAt: this._lastReconcileAt?.toISOString() ?? null,
      lastHintAt: this._lastHintAt?.toISOString() ?? null,
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

    this.universe.apply([], [], feSymbols);

    this._lastRefreshOk = true;

    const target = this.universe.symbolList();
    this.desiredSymbols = [...target];

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
}

function normalizeSymbols(symbols: readonly string[]): string[] {
  return Array.from(new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean))).sort();
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);

  return left.filter((symbol) => !rightSet.has(symbol));
}
