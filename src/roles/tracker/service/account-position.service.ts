import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { REDIS_CLIENT, type RedisClientToken } from '@shared/cache/redis.module';
import {
  HELD_POSITION_DEMAND_HINT_CHANNEL,
  HELD_POSITION_DEMAND_TTL_SEC,
  heldPositionDemandAccountPattern,
  heldPositionDemandLeaseKey,
} from '@shared/cache/held-position-demand.keys';
import { EXECUTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type { PositionModel } from '@external/brokerage/model/account.model';
import type { BrokerageVendor } from '@external/brokerage/vendor/brokerage.vendor';
import { BUS_PUBLISHER } from '@shared/bus/bus.token';
import type { BusPublisher } from '@shared/bus/bus-publisher.interface';
import { WorkerEventFactory } from '@shared/event/event-factory';
import { PositionBookEntity } from '@shared/persistence/position-book/position-book.entity';
import { STOCK_REPOSITORY } from '@shared/persistence/stock/stock.token';
import type { StockRepository } from '@shared/persistence/stock/stock.repository';
import {
  POSITION_REPOSITORY,
  type PositionRepository,
} from '@roles/tracker/repository/position.repository';
import type { TrackerPositionModel } from '@roles/tracker/repository/position.model';
import type { TrackerAccountTarget } from '@roles/tracker/service/tracker-target.service';

const ACCOUNT_POSITION_EVENT_TYPE = 'account.position';
const ACCOUNT_POSITION_SCHEMA_VERSION = 1;

// Per-account position pull: gateway → upsertMany → pubsub. Pubsub event
// carries the full snapshot list (BE-side fan-out filters by accountId
// subscription). Per-target try/catch keeps one bad account from killing
// the scheduler tick.
@Injectable()
export class AccountPositionService {
  private readonly logger = new Logger(AccountPositionService.name);

  private _syncCount = 0;

  private _errorCount = 0;

  private _lastSyncedAt: Date | null = null;

  constructor(
    @Inject(EXECUTOR_BROKERAGE_VENDOR) private readonly gateway: BrokerageVendor,
    @Inject(POSITION_REPOSITORY) private readonly repo: PositionRepository,
    @Inject(STOCK_REPOSITORY) private readonly stockRepo: StockRepository,
    @Inject(BUS_PUBLISHER) private readonly publisher: BusPublisher,
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
    @InjectRepository(PositionBookEntity)
    private readonly positionBooks: Repository<PositionBookEntity>,
    private readonly eventFactory: WorkerEventFactory,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: RedisClientToken,
  ) {}

  syncCount(): number {
    return this._syncCount;
  }

  errorCount(): number {
    return this._errorCount;
  }

  lastSyncedAt(): Date | null {
    return this._lastSyncedAt;
  }

  async syncOne(target: TrackerAccountTarget): Promise<TrackerPositionModel[] | null> {
    try {
      const vendorPositions = await this.gateway.getPositionsForAccount(target.accountId, {
        accountId: target.accountExternalId,
      });

      const now = new Date();

      const models = await this.repo.upsertMany(
        vendorPositions.map((position) => ({
          accountExternalId: target.accountExternalId,
          brokerage: target.brokerage,
          marketEnv: target.marketEnv,
          symbol: position.symbol,
          quantity: position.quantity,
          // Vendor model has no locked-quantity concept yet; leave null.
          lockedQuantity: null,
          averagePrice: position.averagePrice,
          currentPrice:
            position.quantity > 0 && position.marketValue > 0
              ? position.marketValue / position.quantity
              : null,
          marketValue: position.marketValue,
          unrealizedPnl: position.unrealizedPnl,
          syncedAt: now,
        })),
      );
      await this.ensureManualPositionBooks(target, vendorPositions, now);
      await this.refreshHeldSymbolDemandLeases(target, vendorPositions, now);

      this._syncCount += 1;

      this._lastSyncedAt = now;

      await this.publishLive(target, models);

      return models;
    } catch (err) {
      this._errorCount += 1;

      this.logger.warn(
        `account-position sync failed account=${target.accountExternalId}: ${err instanceof Error ? err.message : err}`,
      );

      return null;
    }
  }


  private async refreshHeldSymbolDemandLeases(
    target: TrackerAccountTarget,
    positions: readonly PositionModel[],
    syncedAt: Date,
  ): Promise<void> {
    if (!this.redis) return;

    const positiveSymbols = new Set(
      positions
        .filter((position) => position.quantity > 0)
        .map((position) => position.symbol.trim().toUpperCase())
        .filter(Boolean),
    );
    const pattern = heldPositionDemandAccountPattern({
      marketEnv: target.marketEnv,
      accountExternalId: target.accountExternalId,
    });

    try {
      const existingKeys = await scanKeys(this.redis, pattern);
      let changed = false;

      for (const key of existingKeys) {
        const symbol = key.split(':').at(-1)?.trim().toUpperCase();
        if (symbol && positiveSymbols.has(symbol)) continue;
        const deleted = await this.redis.del(key);
        if (deleted > 0) changed = true;
      }

      for (const symbol of positiveSymbols) {
        const key = heldPositionDemandLeaseKey({
          marketEnv: target.marketEnv,
          accountExternalId: target.accountExternalId,
          symbol,
        });
        await this.redis.set(
          key,
          JSON.stringify({
            source: 'tracker-position',
            accountExternalId: target.accountExternalId,
            brokerage: target.brokerage,
            marketEnv: target.marketEnv,
            symbol,
            syncedAt: syncedAt.toISOString(),
          }),
          'EX',
          HELD_POSITION_DEMAND_TTL_SEC,
        );
        changed = true;
      }

      if (changed) {
        await this.redis.publish(HELD_POSITION_DEMAND_HINT_CHANNEL, 'position-demand');
      }
    } catch (err) {
      this.logger.warn(
        `held-position demand lease refresh failed account=${target.accountExternalId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private async ensureManualPositionBooks(
    target: TrackerAccountTarget,
    positions: readonly PositionModel[],
    syncedAt: Date,
  ): Promise<void> {
    for (const position of positions) {
      if (position.quantity <= 0) continue;

      const stock = await this.stockRepo.findBySymbol(position.symbol);
      if (!stock) {
        this.logger.warn(
          `manual position-book backfill skipped account=${target.accountExternalId} symbol=${position.symbol}: stock not found`,
        );
        continue;
      }

      await this.positionBooks.manager.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          ['position-book', target.accountId, stock.id, 'all'].join(':'),
        ]);

        const existingCount = await manager.count(PositionBookEntity, {
          where: { accountId: target.accountId, stockId: stock.id },
        });
        if (existingCount > 0) return;

        const costAmount = position.quantity * position.averagePrice;
        await manager.insert(PositionBookEntity, {
          accountId: target.accountId,
          stockId: stock.id,
          sourceType: 'MANUAL',
          accountStrategyId: null,
          strategyId: null,
          requestedByUserId: null,
          quantity: String(position.quantity),
          averagePrice: String(position.averagePrice),
          costAmount: String(costAmount),
          realizedAmount: '0',
          lastFillId: null,
          lastFilledAt: syncedAt,
        } as Record<string, unknown>);
      });
    }
  }

  private async publishLive(
    target: TrackerAccountTarget,
    positions: readonly TrackerPositionModel[],
  ): Promise<void> {
    const channel = `account.${this.kiwoom.marketEnv}.position.${target.accountExternalId}`;

    const event = this.eventFactory.build({
      eventType: ACCOUNT_POSITION_EVENT_TYPE,
      schemaVersion: ACCOUNT_POSITION_SCHEMA_VERSION,
      role: 'tracker',
      payload: { positions },
    });

    try {
      await this.publisher.publish(channel, event);
    } catch (err) {
      this.logger.warn(
        `account-position publish failed channel=${channel}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

async function scanKeys(redis: RedisClientToken, pattern: string): Promise<string[]> {
  if (!redis) return [];

  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');

  return keys;
}
