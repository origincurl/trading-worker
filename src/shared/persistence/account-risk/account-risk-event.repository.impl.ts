import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AccountRiskEventModel } from '@shared/model/account-risk/account-risk-event.model';
import { AccountRiskEventEntity } from './account-risk-event.entity';
import type { AccountRiskEventRepository } from './account-risk-event.repository';

@Injectable()
export class AccountRiskEventRepositoryImpl implements AccountRiskEventRepository {
  constructor(
    @Optional()
    @InjectRepository(AccountRiskEventEntity)
    private readonly repo?: Repository<AccountRiskEventEntity>,
  ) {}

  async findByAccountRiskId(arid: number): Promise<AccountRiskEventModel[]> {
    if (!this.repo) return [];

    const rows = await this.repo.find({ where: { accountRiskId: arid } });

    return rows.map((r) => r.toModel());
  }

  async findCandidate(
    accountRiskId: number,
    eventType: string,
  ): Promise<AccountRiskEventModel | null> {
    if (!this.repo) return null;

    const row = await this.repo.findOne({
      where: { accountRiskId, eventType, isEnabled: true },
    });

    return row ? row.toModel() : null;
  }
}
