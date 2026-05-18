import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AccountStrategyModel } from '@shared/model/account-strategy/account-strategy.model';
import { AccountStrategyEntity } from './account-strategy.entity';
import type { AccountStrategyRepository } from './account-strategy.repository';

@Injectable()
export class AccountStrategyRepositoryImpl implements AccountStrategyRepository {
  constructor(
    @Optional()
    @InjectRepository(AccountStrategyEntity)
    private readonly repo?: Repository<AccountStrategyEntity>,
  ) {}

  async findActiveByAccountId(accountId: number): Promise<AccountStrategyModel[]> {
    if (!this.repo) return [];

    const rows = await this.repo.find({ where: { accountId, isActive: true } });

    return rows.map((r) => r.toModel());
  }

  async findAllActive(): Promise<AccountStrategyModel[]> {
    if (!this.repo) return [];

    const rows = await this.repo.find({ where: { isActive: true } });

    return rows.map((r) => r.toModel());
  }
}
