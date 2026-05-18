import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError } from '@common/error/domain.error';
import { ACCOUNT_CREDENTIAL_REPOSITORY } from '@shared/persistence/account-credential/account-credential.token';
import type { AccountCredentialRepository } from '@shared/persistence/account-credential/account-credential.repository';
import { API_CREDENTIAL_REPOSITORY } from '@shared/persistence/api-credential/api-credential.token';
import type { ApiCredentialRepository } from '@shared/persistence/api-credential/api-credential.repository';
import { COLLECTOR_CREDENTIAL_REPOSITORY } from '@shared/persistence/collector-credential/collector-credential.token';
import type { CollectorCredentialRepository } from '@shared/persistence/collector-credential/collector-credential.repository';
import type { Brokerage } from '@shared/model/account/brokerage.enum';
import {
  ApiCredentialStatus,
  type MarketEnv,
} from '@shared/model/api-credential/market-env.enum';
import { CredentialEncryptionService } from '@shared/crypto/credential-encryption.service';
import type { BrokerageCredentialMaterial } from './brokerage-credential-material';
import { CredentialCooldownService } from './credential-cooldown.service';

// Resolves vendor credentials directly from DB (Phase C). Replaces the
// BE control-plane lease path: worker decrypts (appKey, appSecret) from
// collector_credentials (market-wide pool) or api_credentials (account
// scoped pool) and hands the material to the access-token-cache.
//
// Round-robin: each call rotates through the eligible pool so a single
// credential isn't burned by traffic spikes. Persisted across calls via
// an in-memory cursor keyed by (brokerage, marketEnv) — process-local
// only (other pods rotate independently).
@Injectable()
export class CredentialSourceService {
  private readonly logger = new Logger(CredentialSourceService.name);

  private readonly collectorCursor = new Map<string, number>();

  constructor(
    @Inject(COLLECTOR_CREDENTIAL_REPOSITORY)
    private readonly collectorRepo: CollectorCredentialRepository,
    @Inject(ACCOUNT_CREDENTIAL_REPOSITORY)
    private readonly accountCredRepo: AccountCredentialRepository,
    @Inject(API_CREDENTIAL_REPOSITORY)
    private readonly apiCredRepo: ApiCredentialRepository,
    private readonly encryption: CredentialEncryptionService,
    private readonly cooldown: CredentialCooldownService,
  ) {}

  // Collector / market-data pool. Reads active rows from
  // collector_credentials, excludes those currently on cooldown, then
  // picks round-robin. Throws when no usable row exists — boot path
  // catches and reports gateway degraded (architecture parity with the
  // old env-based path that threw on missing app key).
  async selectCollectorCredential(
    brokerage: Brokerage,
    marketEnv: MarketEnv,
  ): Promise<BrokerageCredentialMaterial> {
    const all = await this.collectorRepo.findActive(brokerage, marketEnv);
    const eligible = all.filter((c) => !this.cooldown.isOnCooldown(c.id));

    if (eligible.length === 0) {
      throw new DomainError(
        `no usable collector credential for brokerage=${brokerage} env=${marketEnv}`,
        'COLLECTOR_CREDENTIAL_EXHAUSTED',
        { brokerage, marketEnv, totalActive: all.length },
      );
    }

    const cursorKey = `${brokerage}:${marketEnv}`;
    const cursor = this.collectorCursor.get(cursorKey) ?? Math.floor(Math.random() * eligible.length);
    const picked = eligible[cursor % eligible.length];

    this.collectorCursor.set(cursorKey, cursor + 1);

    const appKey = this.encryption.decrypt(picked.appKeyEnc);
    const appSecret = this.encryption.decrypt(picked.appSecretEnc);

    if (!appKey || !appSecret) {
      throw new DomainError(
        `collector credential id=${picked.id} missing appKey/appSecret material`,
        'COLLECTOR_CREDENTIAL_MATERIAL_MISSING',
        { credentialId: picked.id },
      );
    }

    return {
      credentialId: picked.id,
      brokerage: picked.brokerage,
      marketEnv: picked.marketEnv,
      appKey,
      appSecret,
    };
  }

  // Account-scoped pool. Used by tracker + executor — every call must
  // carry the accountId so we look up the right account_credentials row.
  // The actual secret lives on api_credentials referenced by
  // api_credential_id (post Phase 5 cleanup on BE).
  async selectAccountCredential(accountId: number): Promise<BrokerageCredentialMaterial> {
    const all = await this.accountCredRepo.findByAccountId(accountId);
    const eligible = all
      .filter((c) => c.isActive && c.apiCredentialId !== null && c.brokerage && c.marketEnv)
      .filter((c) => !this.cooldown.isOnCooldown(c.apiCredentialId as number));

    if (eligible.length === 0) {
      throw new DomainError(
        `no usable account credential for accountId=${accountId}`,
        'ACCOUNT_CREDENTIAL_EXHAUSTED',
        { accountId },
      );
    }

    const picked = eligible[0];

    if (!picked.brokerage || !picked.marketEnv || picked.apiCredentialId === null) {
      // Filter above guarantees this — keep TypeScript happy.
      throw new DomainError(
        `account credential id=${picked.id} missing brokerage/marketEnv/apiCredentialId`,
        'ACCOUNT_CREDENTIAL_INCOMPLETE',
        { credentialId: picked.id },
      );
    }

    const api = await this.apiCredRepo.findById(picked.apiCredentialId);

    if (!api || api.status !== ApiCredentialStatus.Active) {
      throw new DomainError(
        `api credential id=${picked.apiCredentialId} not active`,
        'API_CREDENTIAL_NOT_ACTIVE',
        { apiCredentialId: picked.apiCredentialId, status: api?.status },
      );
    }

    const appKey = this.encryption.decrypt(api.appKeyEnc);
    const appSecret = this.encryption.decrypt(api.appSecretEnc);

    if (!appKey || !appSecret) {
      throw new DomainError(
        `api credential id=${api.id} missing appKey/appSecret material`,
        'API_CREDENTIAL_MATERIAL_MISSING',
        { apiCredentialId: api.id },
      );
    }

    return {
      credentialId: api.id,
      brokerage: picked.brokerage,
      marketEnv: picked.marketEnv,
      appKey,
      appSecret,
    };
  }
}
