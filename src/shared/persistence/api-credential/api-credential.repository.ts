import type { ApiCredentialModel } from '@shared/model/api-credential/api-credential.model';

export interface ApiCredentialRepository {
  // Returns the row with all encrypted material intact. Decryption is
  // the caller's responsibility — repository never touches plaintext.
  findById(id: number): Promise<ApiCredentialModel | null>;
}
