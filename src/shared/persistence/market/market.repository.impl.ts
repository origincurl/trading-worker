import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { MarketModel } from '@shared/model/market/market.model';
import { MarketEntity } from './market.entity';
import type { MarketRepository } from './market.repository';

@Injectable()
export class MarketRepositoryImpl implements MarketRepository {
  constructor(
    @Optional()
    @InjectRepository(MarketEntity)
    private readonly repo?: Repository<MarketEntity>,
  ) {}

  async findByCode(code: string): Promise<MarketModel | null> {
    if (!this.repo) return null;

    const row = await this.repo.findOne({ where: { code } });

    return row ? row.toModel() : null;
  }

  async findById(id: number): Promise<MarketModel | null> {
    if (!this.repo) return null;

    const row = await this.repo.findOne({ where: { id } });

    return row ? row.toModel() : null;
  }
}
