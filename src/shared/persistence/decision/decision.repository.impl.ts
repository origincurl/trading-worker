import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DecisionModel } from '@shared/model/decision/decision.model';
import { DecisionEntity } from './decision.entity';
import type { CreateDecisionInput, DecisionRepository } from './decision.repository';

@Injectable()
export class DecisionRepositoryImpl implements DecisionRepository {
  constructor(
    @Optional()
    @InjectRepository(DecisionEntity)
    private readonly repo?: Repository<DecisionEntity>,
  ) {}

  async createDecision(input: CreateDecisionInput): Promise<DecisionModel> {
    if (!this.repo) {
      // Persistence disabled — caller still gets a model so downstream
      // dispatch can proceed in degraded mode.
      return Object.assign(new (class {})() as DecisionModel, {
        ...input,
        id: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
    }

    const saved = await this.repo.save(this.repo.create({ ...input }));

    return saved.toModel();
  }
}
