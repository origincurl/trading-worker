import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { WarningModel } from '@shared/model/warning/warning.model';
import { WarningEntity } from './warning.entity';
import type { CreateWarningInput, WarningRepository } from './warning.repository';

@Injectable()
export class WarningRepositoryImpl implements WarningRepository {
  constructor(
    @Optional()
    @InjectRepository(WarningEntity)
    private readonly repo?: Repository<WarningEntity>,
  ) {}

  async createWarning(input: CreateWarningInput): Promise<WarningModel> {
    if (!this.repo) {
      return Object.assign(new (class {})() as WarningModel, {
        ...input,
        id: 0,
        readAt: null,
        resolvedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
    }

    const saved = await this.repo.save(this.repo.create({ ...input }));

    return saved.toModel();
  }
}
