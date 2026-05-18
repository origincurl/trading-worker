import { Inject, Injectable, Logger } from '@nestjs/common';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { COLLECTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type { BrokerageVendor } from '@external/brokerage/vendor/brokerage.vendor';
import { MARKET_REPOSITORY } from '@shared/persistence/market/market.token';
import type { MarketRepository } from '@shared/persistence/market/market.repository';
import { STOCK_REPOSITORY } from '@shared/persistence/stock/stock.token';
import type {
  StockRepository,
  UpsertStockInput,
} from '@shared/persistence/stock/stock.repository';

// Phase E: pull the vendor's stock master list and upsert into the
// `stocks` table. Runs on the collector schedule (see
// stock-list-sync.scheduler.ts). is_observed is NEVER touched here —
// admin owns observation toggles.
@Injectable()
export class SyncStockListUsecase {
  private readonly logger = new Logger(SyncStockListUsecase.name);

  private _lastRunAt: Date | null = null;

  private _lastRunOk = false;

  private readonly marketIdCache = new Map<string, number | null>();

  constructor(
    @Inject(COLLECTOR_BROKERAGE_VENDOR) private readonly gateway: BrokerageVendor,
    @Inject(STOCK_REPOSITORY) private readonly stockRepo: StockRepository,
    @Inject(MARKET_REPOSITORY) private readonly marketRepo: MarketRepository,
    @Inject(KIWOOM_CONFIG) private readonly kiwoomConfig: KiwoomConfig,
  ) {}

  lastRunAt(): Date | null {
    return this._lastRunAt;
  }

  lastRunOk(): boolean {
    return this._lastRunOk;
  }

  async execute(): Promise<{ inserted: number; updated: number }> {
    this._lastRunAt = new Date();

    try {
      const marketEnv = this.kiwoomConfig.marketEnv === 'production' ? 'production' : 'mock';

      const entries = await this.gateway.getStockMasterList({ marketEnv });

      const rows: UpsertStockInput[] = [];
      let skippedNoMarket = 0;

      for (const entry of entries) {
        const marketId = await this.resolveMarketId(entry.marketCode);

        if (marketId === null) {
          skippedNoMarket += 1;

          this.logger.debug(
            `stock ${entry.symbol} skipped: market ${entry.marketCode} not found in DB`,
          );

          continue;
        }

        rows.push({
          marketId,
          symbol: entry.symbol,
          name: entry.name,
          currency: entry.currency ?? null,
          // Vendor master list is the source of "currently tradable" — we
          // mark every fetched row active+tradable. Admin overrides via
          // observation flag (separate column, untouched here).
          isActive: true,
          isTradable: true,
        });
      }

      const result = await this.stockRepo.upsertMany(rows);

      this._lastRunOk = true;

      this.logger.log(
        `stock list sync done: fetched=${entries.length} inserted=${result.inserted} updated=${result.updated} skippedNoMarket=${skippedNoMarket}`,
      );

      return result;
    } catch (err) {
      this._lastRunOk = false;

      this.logger.warn(
        `stock list sync failed: ${err instanceof Error ? err.message : err}`,
      );

      throw err;
    }
  }

  private async resolveMarketId(marketCode: string): Promise<number | null> {
    if (this.marketIdCache.has(marketCode)) {
      return this.marketIdCache.get(marketCode) ?? null;
    }

    const market = await this.marketRepo.findByCode(marketCode);
    const id = market?.id ?? null;

    this.marketIdCache.set(marketCode, id);

    return id;
  }
}
