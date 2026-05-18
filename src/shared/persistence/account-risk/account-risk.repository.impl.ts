import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AccountRiskModel } from '@shared/model/account-risk/account-risk.model';
import { AccountRiskEntity } from './account-risk.entity';
import type { AccountRiskRepository } from './account-risk.repository';

@Injectable()
export class AccountRiskRepositoryImpl implements AccountRiskRepository {
  constructor(
    @Optional()
    @InjectRepository(AccountRiskEntity)
    private readonly repo?: Repository<AccountRiskEntity>,
  ) {}

  async findActiveByAccountId(accountId: number): Promise<AccountRiskModel[]> {
    if (!this.repo) return [];

    const rows = await this.repo.find({ where: { accountId, isActive: true } });

    return rows.map((r) => r.toModel());
  }

  async findAllActive(): Promise<AccountRiskModel[]> {
    if (!this.repo) return [];

    const rows = await this.repo.find({ where: { isActive: true } });

    return rows.map((r) => r.toModel());
  }
}
