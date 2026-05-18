import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EtfModel } from '@shared/model/etf/etf.model';
import { EtfEntity } from './etf.entity';
import type { EtfRepository } from './etf.repository';

@Injectable()
export class EtfRepositoryImpl implements EtfRepository {
  constructor(
    @Optional()
    @InjectRepository(EtfEntity)
    private readonly repo?: Repository<EtfEntity>,
  ) {}

  async findObservedEtfs(): Promise<EtfModel[]> {
    if (!this.repo) return [];

    const rows = await this.repo.find({ where: { isObserved: true } });

    return rows.map((r) => r.toModel());
  }

  async findBySymbol(symbol: string): Promise<EtfModel | null> {
    if (!this.repo) return null;

    const row = await this.repo.findOne({ where: { symbol } });

    return row ? row.toModel() : null;
  }
}
