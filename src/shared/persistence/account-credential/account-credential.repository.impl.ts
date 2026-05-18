import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AccountCredentialModel } from '@shared/model/account/account-credential.model';
import { AccountCredentialEntity } from './account-credential.entity';
import type { AccountCredentialRepository } from './account-credential.repository';

@Injectable()
export class AccountCredentialRepositoryImpl implements AccountCredentialRepository {
  constructor(
    @Optional()
    @InjectRepository(AccountCredentialEntity)
    private readonly repo?: Repository<AccountCredentialEntity>,
  ) {}

  async findByAccountId(accountId: number): Promise<AccountCredentialModel[]> {
    if (!this.repo) return [];

    const rows = await this.repo.find({ where: { accountId } });

    return rows.map((r) => r.toModel());
  }

  async findById(id: number): Promise<AccountCredentialModel | null> {
    if (!this.repo) return null;

    const row = await this.repo.findOne({ where: { id } });

    return row ? row.toModel() : null;
  }
}
