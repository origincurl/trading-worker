import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { redactPotentialSecrets } from '@common/util/redact.util';
import {
  CollectorCredentialLimitPolicyEntity,
  CollectorCredentialRuntimeStateEntity,
  CollectorCredentialRuntimeStatus,
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

  async markRateLimited(input: {
    credentialId: number;
    retryAfterMs?: number | null;
    reason?: string | null;
  }): Promise<void> {
    await this.safelyRecord('markRateLimited', async () => {
      if (!this.stateRepo) return;

      const policy = await this.findPolicy(input.credentialId);
      const retryAfterMs = normalizeNonNegativeInt(input.retryAfterMs);
      const defaultCooldownMs = cooldownFloorMs(policy?.cooldownDefaultMs);
      const cooldownMs = Math.max(retryAfterMs ?? 0, defaultCooldownMs);
      const now = new Date();
      const cooldownUntil = new Date(now.getTime() + cooldownMs);

      await this.ensureStateRow(input.credentialId);

      await this.updateRecoverableState(input.credentialId, {
        status: CollectorCredentialRuntimeStatus.RateLimited,
        cooldownUntil,
        lastRateLimitedAt: now,
        lastRetryAfterMs: retryAfterMs,
        lastErrorMessage: input.reason ?? null,
      });
    });
  }

  async markAuthFailed(input: { credentialId: number; reason?: string | null }): Promise<void> {
    await this.safelyRecord('markAuthFailed', async () => {
      if (!this.stateRepo) return;

      await this.upsertState(input.credentialId, {
        status: CollectorCredentialRuntimeStatus.AuthFailed,
        cooldownUntil: null,
        lastAuthFailedAt: new Date(),
        lastErrorMessage: input.reason ?? null,
      });
    });
  }

  async markWsLimited(input: { credentialId: number; reason?: string | null }): Promise<void> {
    await this.safelyRecord('markWsLimited', async () => {
      if (!this.stateRepo) return;

      const policy = await this.findPolicy(input.credentialId);
      const cooldownMs = cooldownFloorMs(policy?.cooldownDefaultMs);
      const now = new Date();
      const cooldownUntil = new Date(now.getTime() + cooldownMs);

      await this.ensureStateRow(input.credentialId);

      await this.updateRecoverableState(input.credentialId, {
        status: CollectorCredentialRuntimeStatus.WsLimited,
        cooldownUntil,
        lastWsLimitedAt: now,
        lastErrorMessage: input.reason ?? null,
      });
    });
  }

  async markSuccess(input: {
    credentialId: number;
    source: 'REST' | 'WS' | 'TOKEN';
  }): Promise<void> {
    await this.safelyRecord('markSuccess', async () => {
      if (!this.stateRepo) return;

      const clearableStatuses = clearableStatusesForSuccess(input.source);
      if (clearableStatuses.length === 0) return;

      try {
        await this.stateRepo
          .createQueryBuilder()
          .update(CollectorCredentialRuntimeStateEntity)
          .set({
            status: CollectorCredentialRuntimeStatus.Active,
            cooldownUntil: null,
            lastErrorMessage: null,
          })
          .where('collector_credential_id = :credentialId', {
            credentialId: input.credentialId,
          })
          .andWhere('status IN (:...statuses)', { statuses: clearableStatuses })
          .execute();
      } catch (error) {
        if (isMissingLimitTable(error)) {
          this.logMissingTablesOnce();

          return;
        }

        throw error;
      }
    });
  }

  private async findPolicy(
    credentialId: number,
  ): Promise<CollectorCredentialLimitPolicyEntity | null> {
    if (!this.policyRepo) return null;

    try {
      return await this.policyRepo.findOne({ where: { collectorCredentialId: credentialId } });
    } catch (error) {
      if (isMissingLimitTable(error)) {
        this.logMissingTablesOnce();

        return null;
      }

      throw error;
    }
  }

  private async upsertState(
    credentialId: number,
    input: Partial<CollectorCredentialRuntimeStateEntity>,
  ): Promise<void> {
    if (!this.stateRepo) return;

    try {
      await this.stateRepo.upsert(
        {
          collectorCredentialId: credentialId,
          ...input,
          lastErrorMessage:
            input.lastErrorMessage === undefined
              ? undefined
              : redactPotentialSecrets(input.lastErrorMessage),
        },
        ['collectorCredentialId'],
      );
    } catch (error) {
      if (isMissingLimitTable(error)) {
        this.logMissingTablesOnce();

        return;
      }

      throw error;
    }
  }

  private async ensureStateRow(credentialId: number): Promise<void> {
    if (!this.stateRepo) return;

    try {
      await this.stateRepo
        .createQueryBuilder()
        .insert()
        .into(CollectorCredentialRuntimeStateEntity)
        .values({
          collectorCredentialId: credentialId,
          status: CollectorCredentialRuntimeStatus.Active,
        })
        .orIgnore()
        .execute();
    } catch (error) {
      if (isMissingLimitTable(error)) {
        this.logMissingTablesOnce();

        return;
      }

      throw error;
    }
  }

  private async updateRecoverableState(
    credentialId: number,
    input: {
      status:
        | CollectorCredentialRuntimeStatus.RateLimited
        | CollectorCredentialRuntimeStatus.WsLimited;
      cooldownUntil: Date;
      lastRateLimitedAt?: Date;
      lastRetryAfterMs?: number | null;
      lastWsLimitedAt?: Date;
      lastErrorMessage?: string | null;
    },
  ): Promise<void> {
    if (!this.stateRepo) return;

    const set: Partial<CollectorCredentialRuntimeStateEntity> = {
      status: input.status,
      lastErrorMessage:
        input.lastErrorMessage === undefined
          ? undefined
          : redactPotentialSecrets(input.lastErrorMessage),
    };
    if (input.lastRateLimitedAt) set.lastRateLimitedAt = input.lastRateLimitedAt;
    if (input.lastRetryAfterMs !== undefined) set.lastRetryAfterMs = input.lastRetryAfterMs;
    if (input.lastWsLimitedAt) set.lastWsLimitedAt = input.lastWsLimitedAt;

    try {
      await this.stateRepo
        .createQueryBuilder()
        .update(CollectorCredentialRuntimeStateEntity)
        .set({
          ...set,
          cooldownUntil: () =>
            "GREATEST(COALESCE(cooldown_until, '-infinity'::timestamp), :cooldownUntil)",
        })
        .where('collector_credential_id = :credentialId', { credentialId })
        .andWhere('status != :authFailed', {
          authFailed: CollectorCredentialRuntimeStatus.AuthFailed,
        })
        .setParameter('cooldownUntil', input.cooldownUntil)
        .execute();
    } catch (error) {
      if (isMissingLimitTable(error)) {
        this.logMissingTablesOnce();

        return;
      }

      throw error;
    }
  }

  private logMissingTablesOnce(): void {
    if (this.hasLoggedMissingTables) return;

    this.hasLoggedMissingTables = true;

    this.logger.warn(
      'collector credential limit tables missing; selector falling back to in-memory cooldown only',
    );
  }

  private async safelyRecord(operation: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.warn(
        `${operation} failed; broker flow will continue: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function isMissingLimitTable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '42P01';
}

function normalizeNonNegativeInt(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;

  const parsed = Math.floor(value);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function cooldownFloorMs(value: number | null | undefined): number {
  const parsed = normalizeNonNegativeInt(value);

  return Math.max(parsed ?? 60_000, 1_000);
}

function clearableStatusesForSuccess(
  source: 'REST' | 'WS' | 'TOKEN',
): CollectorCredentialRuntimeStatus[] {
  if (source === 'REST') {
    return [
      CollectorCredentialRuntimeStatus.RateLimited,
      CollectorCredentialRuntimeStatus.Cooldown,
    ];
  }
  if (source === 'WS') return [CollectorCredentialRuntimeStatus.WsLimited];

  return [CollectorCredentialRuntimeStatus.Cooldown];
}
