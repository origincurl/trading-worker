import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AccountStatus } from '@shared/model/account/account-status.enum';
import type { Brokerage } from '@shared/model/account/brokerage.enum';
import type { MarketEnv } from '@shared/model/api-credential/market-env.enum';
import type { AccountModel } from '@shared/model/account/account.model';
import { AccountEntity } from './account.entity';
import type { AccountRepository } from './account.repository';

@Injectable()
export class AccountRepositoryImpl implements AccountRepository {
  constructor(
    @Optional()
    @InjectRepository(AccountEntity)
    private readonly repo?: Repository<AccountEntity>,
  ) {}

  async findById(id: number): Promise<AccountModel | null> {
    if (!this.repo) return null;

    const row = await this.repo.findOne({ where: { id } });

    return row ? row.toModel() : null;
  }

  async findByExternalKey(
    brokerage: Brokerage,
    marketEnv: MarketEnv,
    accountExternalId: string,
  ): Promise<AccountModel | null> {
    if (!this.repo) return null;

    // Join over account_credentials to find the row whose external id
    // matches. account_credentials.market_env carries the env mapping —
    // accounts table itself has no env column.
    const row = await this.repo
      .createQueryBuilder('a')
      .innerJoin(
        'account_credentials',
        'ac',
        'ac.account_id = a.id AND ac.market_env = :marketEnv AND ac.account_external_id = :extId AND ac.is_active = true',
        { marketEnv, extId: accountExternalId },
      )
      .where('a.brokerage = :brokerage', { brokerage })
      .andWhere('a.deleted_at IS NULL')
      .getOne();

    return row ? row.toModel() : null;
  }

  async findActiveAccounts(): Promise<AccountModel[]> {
    if (!this.repo) return [];

    const rows = await this.repo.find({
      where: { status: AccountStatus.Active, deletedAt: IsNull() },
    });

    return rows.map((r) => r.toModel());
  }
}
