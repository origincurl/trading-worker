import { Inject, Injectable, Logger } from '@nestjs/common';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { COLLECTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type { BrokerageVendor } from '@external/brokerage/vendor/brokerage.vendor';
import { DataSource, type EntityManager } from 'typeorm';
import { MARKET_REPOSITORY } from '@shared/persistence/market/market.token';
import type { MarketRepository } from '@shared/persistence/market/market.repository';
import { STOCK_REPOSITORY } from '@shared/persistence/stock/stock.token';
import type {
  StockRepository,
  UpsertStockInput,
} from '@shared/persistence/stock/stock.repository';

const REQUIRED_STOCK_MASTER_MARKETS = ['KOSPI', 'KOSDAQ'] as const;

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
  private krxReferenceDataEnsured = false;

  constructor(
    @Inject(COLLECTOR_BROKERAGE_VENDOR) private readonly gateway: BrokerageVendor,
    @Inject(STOCK_REPOSITORY) private readonly stockRepo: StockRepository,
    @Inject(MARKET_REPOSITORY) private readonly marketRepo: MarketRepository,
    @Inject(KIWOOM_CONFIG) private readonly kiwoomConfig: KiwoomConfig,
    private readonly dataSource: DataSource,
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

      await this.ensureKrxReferenceData();

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
      const missingRequiredMarkets = REQUIRED_STOCK_MASTER_MARKETS.filter(
        (marketCode) => !entries.some((entry) => entry.marketCode === marketCode),
      );

      this._lastRunOk = missingRequiredMarkets.length === 0;

      this.logger.log(
        `stock list sync done: fetched=${entries.length} inserted=${result.inserted} updated=${result.updated} skippedNoMarket=${skippedNoMarket} partial=${!this._lastRunOk}`,
      );

      if (missingRequiredMarkets.length > 0) {
        this.logger.warn(
          `stock list sync partial: missing required markets [${missingRequiredMarkets.join(
            ',',
          )}]`,
        );
      }

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

  private async ensureKrxReferenceData(): Promise<void> {
    if (this.krxReferenceDataEnsured || !this.dataSource.isInitialized) return;

    if (process.env.NODE_ENV === 'production') {
      this.logger.warn(
        'production mode: skipping KRX reference data seed; ensure exchange/market migrations ran',
      );
      this.krxReferenceDataEnsured = true;
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      const exchangeId = await this.ensureKrxExchange(manager);

      await this.ensureKrxMarket(manager, exchangeId, {
        code: 'KOSPI',
        name: 'KOSPI',
      });
      await this.ensureKrxMarket(manager, exchangeId, {
        code: 'KOSDAQ',
        name: 'KOSDAQ',
      });
      await this.ensureKrxMarket(manager, exchangeId, {
        code: 'KONEX',
        name: 'KONEX',
      });
    });

    this.marketIdCache.clear();
    this.krxReferenceDataEnsured = true;
  }

  private async ensureKrxExchange(manager: EntityManager): Promise<number> {
    const existing = await manager.query(
      `SELECT id FROM exchanges WHERE code = $1 AND deleted_at IS NULL LIMIT 1`,
      ['KRX'],
    );

    if (existing[0]?.id !== undefined) return Number(existing[0].id);

    const inserted = await manager.query(
      `
        INSERT INTO exchanges (code, name, country, timezone, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, true, NOW(), NOW())
        RETURNING id
      `,
      ['KRX', 'Korea Exchange', 'KR', 'Asia/Seoul'],
    );

    return Number(inserted[0].id);
  }

  private async ensureKrxMarket(
    manager: EntityManager,
    exchangeId: number,
    market: { code: 'KOSPI' | 'KOSDAQ' | 'KONEX'; name: string },
  ): Promise<void> {
    const existing = await manager.query(
      `SELECT id FROM markets WHERE code = $1 AND deleted_at IS NULL LIMIT 1`,
      [market.code],
    );

    if (existing.length > 0) return;

    await manager.query(
      `
        INSERT INTO markets (
          exchange_id, code, name, country, currency, timezone,
          is_active, is_tradable, is_orderable, open_time, close_time,
          status, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, true, true, true, $7, $8, $9, NOW(), NOW())
      `,
      [
        exchangeId,
        market.code,
        market.name,
        'KR',
        'KRW',
        'Asia/Seoul',
        '09:00',
        '15:30',
        'OPEN',
      ],
    );
  }
}
