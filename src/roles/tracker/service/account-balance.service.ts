import { Inject, Injectable, Logger } from '@nestjs/common';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { EXECUTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type { BrokerageVendor } from '@external/brokerage/vendor/brokerage.vendor';
import { BUS_PUBLISHER } from '@shared/bus/bus.token';
import type { BusPublisher } from '@shared/bus/bus-publisher.interface';
import { WorkerEventFactory } from '@shared/event/event-factory';
import {
  ACCOUNT_BALANCE_REPOSITORY,
  type AccountBalanceRepository,
} from '@roles/tracker/repository/account-balance.repository';
import type { AccountBalanceModel } from '@roles/tracker/repository/account-balance.model';
import type { TrackerAccountTarget } from '@roles/tracker/service/tracker-target.service';

const ACCOUNT_BALANCE_EVENT_TYPE = 'account.balance';
const ACCOUNT_BALANCE_SCHEMA_VERSION = 1;

// Per-account balance pull: BrokerageVendor → DB upsert → pubsub publish.
// Pubsub channel format: `account.{env}.balance.{accountExternalId}`
// (architecture.md §6 keeps account-* channels dot-notation, same as
// market-*). Errors are isolated per-target so one bad account does not
// poison the scheduler tick.
@Injectable()
export class AccountBalanceService {
  private readonly logger = new Logger(AccountBalanceService.name);

  private _syncCount = 0;

  private _errorCount = 0;

  private _lastSyncedAt: Date | null = null;

  constructor(
    @Inject(EXECUTOR_BROKERAGE_VENDOR) private readonly gateway: BrokerageVendor,
    @Inject(ACCOUNT_BALANCE_REPOSITORY) private readonly repo: AccountBalanceRepository,
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

  async syncOne(target: TrackerAccountTarget): Promise<AccountBalanceModel | null> {
    try {
      const vendor = await this.gateway.getAccountBalanceForAccount(target.accountId, {
        accountId: target.accountExternalId,
      });

      const model = await this.repo.upsert({
        accountExternalId: target.accountExternalId,
        brokerage: target.brokerage,
        marketEnv: target.marketEnv,
        currency: vendor.currency,
        cashBalance: vendor.cash,
        availableCash: vendor.buyingPower,
        totalAsset: vendor.equityValue,
        syncedAt: new Date(),
      });

      this._syncCount += 1;

      this._lastSyncedAt = new Date();

      await this.publishLive(model);

      return model;
    } catch (err) {
      this._errorCount += 1;

      this.logger.warn(
        `account-balance sync failed account=${target.accountExternalId}: ${err instanceof Error ? err.message : err}`,
      );

      return null;
    }
  }

  private async publishLive(model: AccountBalanceModel): Promise<void> {
    const channel = `account.${this.kiwoom.marketEnv}.balance.${model.accountExternalId}`;

    const event = this.eventFactory.build({
      eventType: ACCOUNT_BALANCE_EVENT_TYPE,
      schemaVersion: ACCOUNT_BALANCE_SCHEMA_VERSION,
      role: 'tracker',
      payload: model,
    });

    try {
      await this.publisher.publish(channel, event);
    } catch (err) {
      this.logger.warn(
        `account-balance publish failed channel=${channel}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
