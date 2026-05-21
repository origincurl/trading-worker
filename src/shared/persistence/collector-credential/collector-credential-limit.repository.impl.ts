import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  CollectorCredentialLimitPolicyEntity,
  CollectorCredentialRuntimeStateEntity,
} from './collector-credential-limit.entity';
import type {
  CollectorCredentialLimitBundle,
  CollectorCredentialLimitRepository,
} from './collector-credential-limit.repository';

@Injectable()
export class CollectorCredentialLimitRepositoryImpl implements CollectorCredentialLimitRepository {
  private readonly logger = new Logger(CollectorCredentialLimitRepositoryImpl.name);

  private hasLoggedMissingTables = false;

  constructor(
    @Optional()
    @InjectRepository(CollectorCredentialLimitPolicyEntity)
    private readonly policyRepo?: Repository<CollectorCredentialLimitPolicyEntity>,
    @Optional()
    @InjectRepository(CollectorCredentialRuntimeStateEntity)
    private readonly stateRepo?: Repository<CollectorCredentialRuntimeStateEntity>,
  ) {}

  async findByCredentialIds(
    credentialIds: readonly number[],
  ): Promise<CollectorCredentialLimitBundle> {
    if (!this.policyRepo || !this.stateRepo || credentialIds.length === 0) {
      return { policies: new Map(), states: new Map() };
    }

    let policies: CollectorCredentialLimitPolicyEntity[];
    let states: CollectorCredentialRuntimeStateEntity[];

    try {
      [policies, states] = await Promise.all([
        this.policyRepo.find({ where: { collectorCredentialId: In([...credentialIds]) } }),
        this.stateRepo.find({ where: { collectorCredentialId: In([...credentialIds]) } }),
      ]);
    } catch (error) {
      if (isMissingLimitTable(error)) {
        if (!this.hasLoggedMissingTables) {
          this.hasLoggedMissingTables = true;
          this.logger.warn(
            'collector credential limit tables missing; selector falling back to in-memory cooldown only',
          );
        }

        return { policies: new Map(), states: new Map() };
      }
      throw error;
    }

    return {
      policies: new Map(policies.map((policy) => [policy.collectorCredentialId, policy])),
      states: new Map(states.map((state) => [state.collectorCredentialId, state])),
    };
  }
}

function isMissingLimitTable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '42P01';
}
