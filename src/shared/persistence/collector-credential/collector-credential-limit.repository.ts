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
}
