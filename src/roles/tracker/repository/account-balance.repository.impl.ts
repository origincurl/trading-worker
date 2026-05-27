import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountBalanceEntity } from './account-balance.entity';
import type { AccountBalanceModel } from './account-balance.model';
import type {
  AccountBalanceRepository,
  UpsertAccountBalanceInput,
} from './account-balance.repository';

// TypeORM impl. Degraded-boot policy: when persistence is disabled, return
// the in-memory model echo so polling can still drive pubsub publishes
// during local dev with no DB attached.
@Injectable()
export class AccountBalanceRepositoryImpl implements AccountBalanceRepository {
  private readonly logger = new Logger(AccountBalanceRepositoryImpl.name);

  constructor(
    @Optional()
    @InjectRepository(AccountBalanceEntity)
    private readonly repo?: Repository<AccountBalanceEntity>,
  ) {}

  async upsert(input: UpsertAccountBalanceInput): Promise<AccountBalanceModel> {
    if (!this.repo) {
      this.logger.debug(
        `persistence disabled — account_balances upsert skipped (${input.accountExternalId})`,
      );

      return {
        accountExternalId: input.accountExternalId,
        brokerage: input.brokerage,
        marketEnv: input.marketEnv,
        currency: input.currency,
        cashBalance: input.cashBalance,
        availableCash: input.availableCash,
        totalAsset: input.totalAsset,
        cashDetails: input.cashDetails,
        syncedAt: input.syncedAt.toISOString(),
      };
    }

    const existing = await this.repo.findOne({
      where: {
        accountExternalId: input.accountExternalId,
        brokerage: input.brokerage,
        marketEnv: input.marketEnv,
      },
    });

    const entity = this.repo.create({
      ...(existing ?? {}),
      accountExternalId: input.accountExternalId,
      brokerage: input.brokerage,
      marketEnv: input.marketEnv,
      currency: input.currency,
      cashBalance: input.cashBalance,
      availableCash: input.availableCash,
      totalAsset: input.totalAsset,
      cashDetails: input.cashDetails,
      syncedAt: input.syncedAt,
    });

    const saved = await this.repo.save(entity);

    return saved.toModel();
  }

  async findByAccount(
    accountExternalId: string,
    brokerage: string,
    marketEnv: 'mock' | 'production',
  ): Promise<AccountBalanceModel | null> {
    if (!this.repo) return null;

    const row = await this.repo.findOne({
      where: { accountExternalId, brokerage, marketEnv },
    });

    return row ? row.toModel() : null;
  }
}
