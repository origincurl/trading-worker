import { Global, Module } from '@nestjs/common';
import { CredentialEncryptionService } from './credential-encryption.service';

// Global so any service can @Inject CredentialEncryptionService without
// the module being added to every role's imports. Matches PolicyModule
// pattern.
@Global()
@Module({
  providers: [CredentialEncryptionService],
  exports: [CredentialEncryptionService],
})
export class CryptoModule {}
