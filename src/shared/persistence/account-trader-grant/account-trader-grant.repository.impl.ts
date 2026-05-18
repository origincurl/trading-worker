import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AccountTraderGrantModel } from '@shared/model/account/account-trader-grant.model';
import { AccountTraderGrantEntity } from './account-trader-grant.entity';
import type { AccountTraderGrantRepository } from './account-trader-grant.repository';

@Injectable()
export class AccountTraderGrantRepositoryImpl implements AccountTraderGrantRepository {
  constructor(
    @Optional()
    @InjectRepository(AccountTraderGrantEntity)
    private readonly repo?: Repository<AccountTraderGrantEntity>,
  ) {}

  async findActiveByTraderId(traderId: number): Promise<AccountTraderGrantModel[]> {
    if (!this.repo) return [];

    const rows = await this.repo.find({ where: { traderId, isActive: true } });

    return rows.map((r) => r.toModel());
  }

  async findActiveByAccountId(accountId: number): Promise<AccountTraderGrantModel[]> {
    if (!this.repo) return [];

    const rows = await this.repo.find({ where: { accountId, isActive: true } });

    return rows.map((r) => r.toModel());
  }
}
