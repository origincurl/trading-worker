import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { StrategyModel } from '@shared/model/strategy/strategy.model';
import { StrategyEntity } from './strategy.entity';
import type { StrategyRepository } from './strategy.repository';

@Injectable()
export class StrategyRepositoryImpl implements StrategyRepository {
  constructor(
    @Optional()
    @InjectRepository(StrategyEntity)
    private readonly repo?: Repository<StrategyEntity>,
  ) {}

  async findById(id: number): Promise<StrategyModel | null> {
    if (!this.repo) return null;

    const row = await this.repo.findOne({ where: { id } });

    return row ? row.toModel() : null;
  }

  async findByIds(ids: readonly number[]): Promise<StrategyModel[]> {
    if (!this.repo || ids.length === 0) return [];

    const rows = await this.repo.find({ where: { id: In(ids as number[]) } });

    return rows.map((r) => r.toModel());
  }
}
