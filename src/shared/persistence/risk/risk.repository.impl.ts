import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { RiskModel } from '@shared/model/risk/risk.model';
import { RiskEntity } from './risk.entity';
import type { RiskRepository } from './risk.repository';

@Injectable()
export class RiskRepositoryImpl implements RiskRepository {
  constructor(
    @Optional()
    @InjectRepository(RiskEntity)
    private readonly repo?: Repository<RiskEntity>,
  ) {}

  async findById(id: number): Promise<RiskModel | null> {
    if (!this.repo) return null;

    const row = await this.repo.findOne({ where: { id } });

    return row ? row.toModel() : null;
  }

  async findByIds(ids: readonly number[]): Promise<RiskModel[]> {
    if (!this.repo || ids.length === 0) return [];

    const rows = await this.repo.find({ where: { id: In(ids as number[]) } });

    return rows.map((r) => r.toModel());
  }
}
