import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { StockModel } from '@shared/model/stock/stock.model';
import { StockEntity } from './stock.entity';
import type { StockRepository, UpsertStockInput } from './stock.repository';

@Injectable()
export class StockRepositoryImpl implements StockRepository {
  constructor(
    @Optional()
    @InjectRepository(StockEntity)
    private readonly repo?: Repository<StockEntity>,
  ) {}

  async findObservedStocks(): Promise<StockModel[]> {
    if (!this.repo) return [];

    const rows = await this.repo.find({ where: { isObserved: true } });

    return rows.map((r) => r.toModel());
  }

  async findActiveListedStocks(): Promise<StockModel[]> {
    if (!this.repo) return [];

    const rows = await this.repo
      .createQueryBuilder('s')
      .where('s.is_active = true')
      .andWhere('s.is_tradable = true')
      .andWhere('s.deleted_at IS NULL')
      .andWhere('s.delisted_at IS NULL')
      .orderBy('s.symbol', 'ASC')
      .getMany();

    return rows.map((r) => r.toModel());
  }

  async getArchivePreflightStats(threshold: Date): Promise<{
    activeListedCount: number;
    syncedAfterThresholdCount: number;
    maxLastSyncedAt: Date | null;
  }> {
    if (!this.repo) {
      return { activeListedCount: 0, syncedAfterThresholdCount: 0, maxLastSyncedAt: null };
    }

    const row = await this.repo
      .createQueryBuilder('s')
      .select('COUNT(*)::int', 'activeListedCount')
      .addSelect(
        `COUNT(*) FILTER (WHERE s.last_synced_at >= :threshold)::int`,
        'syncedAfterThresholdCount',
      )
      .addSelect('MAX(s.last_synced_at)', 'maxLastSyncedAt')
      .where('s.is_active = true')
      .andWhere('s.is_tradable = true')
      .andWhere('s.deleted_at IS NULL')
      .andWhere('s.delisted_at IS NULL')
      .setParameter('threshold', threshold)
      .getRawOne<{
        activeListedCount: number | string;
        syncedAfterThresholdCount: number | string;
        maxLastSyncedAt: Date | string | null;
      }>();

    return {
      activeListedCount: Number(row?.activeListedCount ?? 0),
      syncedAfterThresholdCount: Number(row?.syncedAfterThresholdCount ?? 0),
      maxLastSyncedAt: row?.maxLastSyncedAt ? new Date(row.maxLastSyncedAt) : null,
    };
  }

  async findBySymbol(symbol: string): Promise<StockModel | null> {
    if (!this.repo) return null;

    const row = await this.repo.findOne({ where: { symbol } });

    return row ? row.toModel() : null;
  }

  async findById(id: number): Promise<StockModel | null> {
    if (!this.repo) return null;

    const row = await this.repo.findOne({ where: { id } });

    return row ? row.toModel() : null;
  }

  async findIdByExternalKey(marketCode: string, symbol: string): Promise<number | null> {
    if (!this.repo) return null;

    // Resolved via a join on markets.code. Selects id only — entity-level
    // findOne would require building the relation graph for one column.
    const row = await this.repo
      .createQueryBuilder('s')
      .innerJoin('markets', 'm', 'm.id = s.market_id')
      .where('m.code = :marketCode', { marketCode })
      .andWhere('s.symbol = :symbol', { symbol })
      .andWhere('s.deleted_at IS NULL')
      .select('s.id', 'id')
      .getRawOne<{ id: string | number }>();

    if (!row) return null;

    return typeof row.id === 'string' ? Number(row.id) : row.id;
  }

  async upsertMany(
    rows: readonly UpsertStockInput[],
  ): Promise<{ inserted: number; updated: number }> {
    if (!this.repo || rows.length === 0) return { inserted: 0, updated: 0 };

    let inserted = 0;
    let updated = 0;

    // Per-row upsert keeps the conflict surface explicit (unique partial
    // index on (market_id, symbol) WHERE deleted_at IS NULL). Vendor
    // master fetch produces O(thousands), not O(millions), so a batched
    // insert isn't worth the SQL builder complexity yet.
    for (const row of rows) {
      const existing = await this.repo.findOne({
        where: { marketId: row.marketId, symbol: row.symbol },
      });

      // TypeORM's _QueryDeepPartialEntity treats json objects as
      // deep-partial recursively; the plain Record<string,unknown> we
      // accept on UpsertStockInput doesn't satisfy that. Cast through
      // unknown locally to keep the public input shape ergonomic.
      const metadataField = (row.metadata ?? null) as unknown as never;

      if (existing) {
        await this.repo.update(
          { id: existing.id },
          {
            name: row.name,
            englishName: row.englishName ?? null,
            sector: row.sector ?? null,
            industry: row.industry ?? null,
            currency: row.currency ?? null,
            isActive: row.isActive,
            isTradable: row.isTradable,
            listedAt: row.listedAt ?? null,
            delistedAt: row.delistedAt ?? null,
            metadata: metadataField,
            lastSyncedAt: new Date(),
          },
        );

        updated += 1;
      } else {
        await this.repo.insert({
          marketId: row.marketId,
          symbol: row.symbol,
          name: row.name,
          englishName: row.englishName ?? null,
          sector: row.sector ?? null,
          industry: row.industry ?? null,
          currency: row.currency ?? null,
          isActive: row.isActive,
          isTradable: row.isTradable,
          // is_observed stays false by default — admin owns observation toggle.
          isObserved: false,
          metadata: metadataField,
          listedAt: row.listedAt ?? null,
          delistedAt: row.delistedAt ?? null,
          lastSyncedAt: new Date(),
        });

        inserted += 1;
      }
    }

    return { inserted, updated };
  }
}
