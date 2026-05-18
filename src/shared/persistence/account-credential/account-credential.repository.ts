import type { AccountCredentialModel } from '@shared/model/account/account-credential.model';

export interface AccountCredentialRepository {
  findByAccountId(accountId: number): Promise<AccountCredentialModel[]>;
  findById(id: number): Promise<AccountCredentialModel | null>;
}
