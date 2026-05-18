import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AccountStrategyEventModel } from '@shared/model/account-strategy/account-strategy-event.model';
import { AccountStrategyEventEntity } from './account-strategy-event.entity';
import type { AccountStrategyEventRepository } from './account-strategy-event.repository';

@Injectable()
export class AccountStrategyEventRepositoryImpl implements AccountStrategyEventRepository {
  constructor(
    @Optional()
    @InjectRepository(AccountStrategyEventEntity)
    private readonly repo?: Repository<AccountStrategyEventEntity>,
  ) {}

  async findByAccountStrategyId(asid: number): Promise<AccountStrategyEventModel[]> {
    if (!this.repo) return [];

    const rows = await this.repo.find({ where: { accountStrategyId: asid } });

    return rows.map((r) => r.toModel());
  }

  async findCandidate(
    accountStrategyId: number,
    eventType: string,
  ): Promise<AccountStrategyEventModel | null> {
    if (!this.repo) return null;

    const row = await this.repo.findOne({
      where: { accountStrategyId, eventType, isEnabled: true },
    });

    return row ? row.toModel() : null;
  }
}
