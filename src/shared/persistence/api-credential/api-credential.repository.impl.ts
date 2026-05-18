import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ApiCredentialModel } from '@shared/model/api-credential/api-credential.model';
import { ApiCredentialEntity } from './api-credential.entity';
import type { ApiCredentialRepository } from './api-credential.repository';

@Injectable()
export class ApiCredentialRepositoryImpl implements ApiCredentialRepository {
  constructor(
    @Optional()
    @InjectRepository(ApiCredentialEntity)
    private readonly repo?: Repository<ApiCredentialEntity>,
  ) {}

  async findById(id: number): Promise<ApiCredentialModel | null> {
    if (!this.repo) return null;

    const row = await this.repo.findOne({ where: { id } });

    return row ? row.toModel() : null;
  }
}
