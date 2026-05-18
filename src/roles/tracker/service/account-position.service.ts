import { Inject, Injectable, Logger } from '@nestjs/common';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { EXECUTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type { BrokerageVendor } from '@external/brokerage/vendor/brokerage.vendor';
import { BUS_PUBLISHER } from '@shared/bus/bus.token';
import type { BusPublisher } from '@shared/bus/bus-publisher.interface';
import { WorkerEventFactory } from '@shared/event/event-factory';
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
    @Inject(BUS_PUBLISHER) private readonly publisher: BusPublisher,
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
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
          syncedAt: now,
        })),
      );

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
