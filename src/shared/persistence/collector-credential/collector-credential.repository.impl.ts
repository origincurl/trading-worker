import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { redactPotentialSecrets } from '@common/util/redact.util';
import type { Brokerage } from '@shared/model/account/brokerage.enum';
import {
  ApiCredentialStatus,
  type MarketEnv,
} from '@shared/model/api-credential/market-env.enum';
import type { CollectorCredentialModel } from '@shared/model/collector-credential/collector-credential.model';
import { CollectorCredentialEntity } from './collector-credential.entity';
import type { CollectorCredentialRepository } from './collector-credential.repository';

@Injectable()
export class CollectorCredentialRepositoryImpl implements CollectorCredentialRepository {
  constructor(
    @Optional()
    @InjectRepository(CollectorCredentialEntity)
    private readonly repo?: Repository<CollectorCredentialEntity>,
  ) {}

  async findActive(
    brokerage: Brokerage,
    marketEnv: MarketEnv,
  ): Promise<CollectorCredentialModel[]> {
    if (!this.repo) return [];

    const rows = await this.repo.find({
      where: {
        brokerage,
        marketEnv,
        status: ApiCredentialStatus.Active,
        deletedAt: IsNull(),
      },
    });

    return rows.map((r) => r.toModel());
  }

  async markSuccess(id: number): Promise<void> {
    if (!this.repo) return;

    await this.repo.update(
      { id },
      {
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    );
  }

  async markFailure(id: number, reason: string): Promise<void> {
    if (!this.repo) return;

    // Atomic increment on consecutive_failures via raw SET expression so
    // concurrent probes don't clobber each other.
    await this.repo
      .createQueryBuilder()
      .update(CollectorCredentialEntity)
      .set({
        lastFailedAt: new Date(),
        lastErrorMessage: redactPotentialSecrets(reason),
        consecutiveFailures: () => '"consecutive_failures" + 1',
      })
      .where({ id })
      .execute();
  }
}
