import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ExchangeModel } from '@shared/model/exchange/exchange.model';
import { ExchangeEntity } from './exchange.entity';
import type { ExchangeRepository } from './exchange.repository';

@Injectable()
export class ExchangeRepositoryImpl implements ExchangeRepository {
  constructor(
    @Optional()
    @InjectRepository(ExchangeEntity)
    private readonly repo?: Repository<ExchangeEntity>,
  ) {}

  async findByCode(code: string): Promise<ExchangeModel | null> {
    if (!this.repo) return null;

    const row = await this.repo.findOne({ where: { code } });

    return row ? row.toModel() : null;
  }

  async findById(id: number): Promise<ExchangeModel | null> {
    if (!this.repo) return null;

    const row = await this.repo.findOne({ where: { id } });

    return row ? row.toModel() : null;
  }
}
