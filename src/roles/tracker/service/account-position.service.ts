import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
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
