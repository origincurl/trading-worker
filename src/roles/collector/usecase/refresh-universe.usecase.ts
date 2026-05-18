import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { COLLECTOR_CONFIG, type CollectorConfig } from '@config/collector.config';
import { COLLECTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type {
  BrokerageVendor,
  MarketDataFrameKind,
} from '@external/brokerage/vendor/brokerage.vendor';
import { REDIS_CLIENT, type RedisClientToken } from '@shared/cache/redis.module';
import type { ObservedSymbolModel } from '@shared/model/universe/observed-symbol.model';
import { ETF_REPOSITORY } from '@shared/persistence/etf/etf.token';
import type { EtfRepository } from '@shared/persistence/etf/etf.repository';
import { STOCK_REPOSITORY } from '@shared/persistence/stock/stock.token';
import type { StockRepository } from '@shared/persistence/stock/stock.repository';
import { UniverseService } from '@roles/collector/service/universe.service';
import { SubscriptionPlannerService } from '@roles/collector/service/subscription-planner.service';

// FE-observation refcnt HASH key. BE WS gateway maintains it (HINCRBY on
// subscribe / HDEL on count→0). Worker reads HKEYS — values are
// reference counts, not used here.
const FE_OBSERVATION_HASH = 'fe:observation:stocks:refcnt';

// Pulls the combined observation universe from DB (admin-observed stocks
// + ETFs) and Redis (FE-observed) and re-applies it to the in-memory
// UniverseService. Failure on any fetch is tolerated — we keep the
// previous snapshot so a transient DB/Redis hiccup never tears down
// vendor WS subscriptions.
@Injectable()
export class RefreshUniverseUsecase {
  private readonly logger = new Logger(RefreshUniverseUsecase.name);

  private _lastRefreshAt: Date | null = null;

  private _lastRefreshOk = false;

  constructor(
    @Inject(COLLECTOR_CONFIG) private readonly collectorConfig: CollectorConfig,
    @Inject(COLLECTOR_BROKERAGE_VENDOR) private readonly gateway: BrokerageVendor,
    @Inject(STOCK_REPOSITORY) private readonly stockRepo: StockRepository,
    @Inject(ETF_REPOSITORY) private readonly etfRepo: EtfRepository,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: RedisClientToken,
    private readonly universe: UniverseService,
    private readonly planner: SubscriptionPlannerService,
  ) {
    // SubscriptionPlannerService is intentionally injected even though
    // the refresh path currently re-subscribes the full target set —
    // hardening will swap the gateway's bulk REG for a planner diff
    // once the gateway exposes its current sub set.
    void this.planner;
  }

  lastRefreshAt(): Date | null {
    return this._lastRefreshAt;
  }

  lastRefreshOk(): boolean {
    return this._lastRefreshOk;
  }

  async execute(): Promise<void> {
    this._lastRefreshAt = new Date();

    let adminStocks: ObservedSymbolModel[];
    let adminEtfs: ObservedSymbolModel[];
    let feSymbols: ObservedSymbolModel[];

    try {
      const [stockRows, etfRows, feKeys] = await Promise.all([
        this.stockRepo.findObservedStocks(),
        this.etfRepo.findObservedEtfs(),
        this.readFeObservedSymbols(),
      ]);

      adminStocks = stockRows.map((s) => ({
        symbol: s.symbol,
        source: 'ADMIN' as const,
        instrumentType: 'STOCK' as const,
      }));

      adminEtfs = etfRows.map((e) => ({
        symbol: e.symbol,
        source: 'ADMIN' as const,
        instrumentType: 'ETF' as const,
      }));

      feSymbols = feKeys.map((symbol) => ({
        symbol,
        source: 'FE' as const,
        instrumentType: 'STOCK' as const,
      }));
    } catch (err) {
      this._lastRefreshOk = false;

      this.logger.warn(
        `observed-symbols fetch failed: ${err instanceof Error ? err.message : err}`,
      );

      return;
    }

    this.universe.apply(adminStocks, adminEtfs, feSymbols);

    this._lastRefreshOk = true;

    const target = this.universe.symbolList();

    if (!this.gateway.isMarketDataStreamConnected()) {
      this.logger.warn('gateway not connected — universe REG deferred');

      return;
    }

    const kinds: MarketDataFrameKind[] = ['trade-tick'];

    if (this.collectorConfig.subscribeOrderbook) kinds.push('orderbook');

    if (target.length > 0) {
      await this.gateway.subscribeMarketData({ symbols: [...target], kinds });

      this.logger.log(`universe REG symbols=${target.length} kinds=[${kinds.join(',')}]`);
    }
  }

  private async readFeObservedSymbols(): Promise<string[]> {
    if (!this.redis) return [];

    try {
      // HKEYS returns the symbol set. Refcnt values themselves are not
      // needed — BE GC removes the key once count→0.
      const keys = await this.redis.hkeys(FE_OBSERVATION_HASH);

      return Array.isArray(keys) ? keys : [];
    } catch (err) {
      this.logger.warn(
        `redis hkeys ${FE_OBSERVATION_HASH} failed: ${err instanceof Error ? err.message : err}`,
      );

      return [];
    }
  }
}
