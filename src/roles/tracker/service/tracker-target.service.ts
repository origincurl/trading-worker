import { Inject, Injectable, Logger } from '@nestjs/common';
import { shouldHandle } from '@common/util/shard';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import { ACCOUNT_REPOSITORY } from '@shared/persistence/account/account.token';
import type { AccountRepository } from '@shared/persistence/account/account.repository';
import { ACCOUNT_CREDENTIAL_REPOSITORY } from '@shared/persistence/account-credential/account-credential.token';
import type { AccountCredentialRepository } from '@shared/persistence/account-credential/account-credential.repository';

// Phase F: tracker targets are derived from DB accounts (active +
// credentialed) instead of TRACKER_ACCOUNT_TARGETS env JSON. We resolve
// per call so a new account/credential added at runtime gets picked up
// on the next scheduler tick without a worker restart.
export interface TrackerAccountTarget {
  readonly accountId: number;
  readonly accountExternalId: string;
  readonly brokerage: string;
  readonly marketEnv: 'mock' | 'production';
  readonly accountCredentialId: number;
  readonly apiCredentialId: number;
}

@Injectable()
export class TrackerTargetService {
  private readonly logger = new Logger(TrackerTargetService.name);

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
    @Inject(ACCOUNT_REPOSITORY) private readonly accountRepo: AccountRepository,
    @Inject(ACCOUNT_CREDENTIAL_REPOSITORY)
    private readonly accountCredentialRepo: AccountCredentialRepository,
  ) {}

  // Returns the targets this worker instance is responsible for, applying
  // the shared shard predicate when SHARD_INDEX/COUNT are configured.
  // Filtering chain:
  //   accounts.status=ACTIVE AND deleted_at IS NULL
  //   → has at least one account_credentials row with is_active=true
  //   → shard hash on accountExternalId matches this pod
  async shardedTargets(): Promise<TrackerAccountTarget[]> {
    const accounts = await this.accountRepo.findActiveAccounts();
    const targets: TrackerAccountTarget[] = [];
    const expectedMarketEnv = this.expectedMarketEnv();

    for (const account of accounts) {
      const credentials = await this.accountCredentialRepo.findByAccountId(account.id);
      const active = credentials.find(
        (c) =>
          c.isActive &&
          c.brokerage !== null &&
          c.marketEnv !== null &&
          c.marketEnv === expectedMarketEnv &&
          c.accountExternalId !== null &&
          c.apiCredentialId !== null,
      );

      if (
        !active ||
        !active.brokerage ||
        !active.marketEnv ||
        !active.accountExternalId ||
        active.apiCredentialId === null
      ) {
        continue;
      }

      targets.push({
        accountId: account.id,
        accountExternalId: active.accountExternalId,
        brokerage: active.brokerage,
        marketEnv: active.marketEnv === 'PRODUCTION' ? 'production' : 'mock',
        accountCredentialId: active.id,
        apiCredentialId: active.apiCredentialId,
      });
    }

    return targets.filter((target) =>
      shouldHandle(target.accountExternalId, this.runtime.shardIndex, this.runtime.shardCount),
    );
  }

  async findShardedTargetByExternalId(
    accountExternalId: string,
  ): Promise<TrackerAccountTarget | null> {
    const targets = await this.shardedTargets();

    return targets.find((target) => target.accountExternalId === accountExternalId) ?? null;
  }

  async activeCredentialTargets(): Promise<TrackerAccountTarget[]> {
    const accounts = await this.accountRepo.findActiveAccounts();
    const byCredentialId = new Map<number, TrackerAccountTarget>();
    const expectedMarketEnv = this.expectedMarketEnv();

    for (const account of accounts) {
      const credentials = await this.accountCredentialRepo.findByAccountId(account.id);
      const active = credentials.find(
        (c) =>
          c.isActive &&
          c.brokerage !== null &&
          c.marketEnv !== null &&
          c.marketEnv === expectedMarketEnv &&
          c.accountExternalId !== null &&
          c.apiCredentialId !== null,
      );

      if (
        !active ||
        !active.brokerage ||
        !active.marketEnv ||
        !active.accountExternalId ||
        active.apiCredentialId === null
      ) {
        continue;
      }

      byCredentialId.set(active.apiCredentialId, {
        accountId: account.id,
        accountExternalId: active.accountExternalId,
        brokerage: active.brokerage,
        marketEnv: active.marketEnv === 'PRODUCTION' ? 'production' : 'mock',
        accountCredentialId: active.id,
        apiCredentialId: active.apiCredentialId,
      });
    }

    return Array.from(byCredentialId.values()).sort((a, b) => a.apiCredentialId - b.apiCredentialId);
  }

  private expectedMarketEnv(): 'MOCK' | 'PRODUCTION' {
    return this.kiwoom.marketEnv === 'production' ? 'PRODUCTION' : 'MOCK';
  }
}
