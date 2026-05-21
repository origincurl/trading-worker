import {
  CollectorCredentialLimitPolicyEntity,
  CollectorCredentialRuntimeStateEntity,
} from './collector-credential-limit.entity';

export interface CollectorCredentialLimitBundle {
  readonly policies: Map<number, CollectorCredentialLimitPolicyEntity>;
  readonly states: Map<number, CollectorCredentialRuntimeStateEntity>;
}

export interface CollectorCredentialLimitRepository {
  findByCredentialIds(credentialIds: readonly number[]): Promise<CollectorCredentialLimitBundle>;

  markRateLimited(input: {
    credentialId: number;
    retryAfterMs?: number | null;
    reason?: string | null;
  }): Promise<void>;

  markAuthFailed(input: { credentialId: number; reason?: string | null }): Promise<void>;

  markWsLimited(input: { credentialId: number; reason?: string | null }): Promise<void>;

  markSuccess(input: { credentialId: number; source: 'REST' | 'WS' | 'TOKEN' }): Promise<void>;
}
