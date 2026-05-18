import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PositionEntity } from './position.entity';
import type { TrackerPositionModel } from './position.model';
import type { PositionRepository, UpsertPositionInput } from './position.repository';

// TypeORM impl. Whole-account replace semantics live in the service layer
// (it can drive a delete+insert against this interface). Here we expose a
// row-level upsertMany so vendor adapters dictate the truth set.
@Injectable()
export class PositionRepositoryImpl implements PositionRepository {
  private readonly logger = new Logger(PositionRepositoryImpl.name);

  constructor(
    @Optional()
    @InjectRepository(PositionEntity)
    private readonly repo?: Repository<PositionEntity>,
  ) {}

  async upsertMany(inputs: readonly UpsertPositionInput[]): Promise<TrackerPositionModel[]> {
    if (!this.repo) {
      this.logger.debug(
        `persistence disabled — account_positions upsert skipped (${inputs.length} rows)`,
      );

      return inputs.map((input) => ({
        accountExternalId: input.accountExternalId,
        brokerage: input.brokerage,
        marketEnv: input.marketEnv,
        symbol: input.symbol,
        quantity: input.quantity,
        lockedQuantity: input.lockedQuantity,
        averagePrice: input.averagePrice,
        syncedAt: input.syncedAt.toISOString(),
      }));
    }

    const out: TrackerPositionModel[] = [];

    for (const input of inputs) {
      const existing = await this.repo.findOne({
        where: {
          accountExternalId: input.accountExternalId,
          brokerage: input.brokerage,
          marketEnv: input.marketEnv,
          symbol: input.symbol,
        },
      });

      const entity = this.repo.create({
        ...(existing ?? {}),
        accountExternalId: input.accountExternalId,
        brokerage: input.brokerage,
        marketEnv: input.marketEnv,
        symbol: input.symbol,
        quantity: input.quantity,
        lockedQuantity: input.lockedQuantity,
        averagePrice: input.averagePrice,
        syncedAt: input.syncedAt,
      });

      const saved = await this.repo.save(entity);

      out.push(saved.toModel());
    }

    return out;
  }

  async findByAccount(
    accountExternalId: string,
    brokerage: string,
    marketEnv: 'mock' | 'production',
  ): Promise<TrackerPositionModel[]> {
    if (!this.repo) return [];

    const rows = await this.repo.find({
      where: { accountExternalId, brokerage, marketEnv },
    });

    return rows.map((row) => row.toModel());
  }
}
