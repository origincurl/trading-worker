import { Injectable, Logger } from '@nestjs/common';
import { createDecipheriv, createHash, createHmac, randomBytes } from 'crypto';

// Worker-side mirror of trading-be EncryptionService
// (trading-be/src/domain/api-credential/service/encryption.service.ts).
// Both processes share the same `CREDENTIAL_ENCRYPTION_KEY` so worker can
// decrypt rows that BE encrypted at admin-write time.
//
// Format produced by BE: `v1:<iv hex>:<ciphertext hex>:<authTag hex>` using
// AES-256-GCM. The key material is SHA-256 of the env value (any length
// string accepted, matches BE derivation).
//
// Worker only needs decrypt + appKey hashing; encrypt belongs on BE (admin
// is the sole writer of credential rows).

const VERSION_PREFIX = 'v1:';
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;

@Injectable()
export class CredentialEncryptionService {
  private readonly logger = new Logger(CredentialEncryptionService.name);

  private readonly key: Buffer;

  private readonly appKeyHashSecret: string;

  constructor() {
    const raw = process.env.CREDENTIAL_ENCRYPTION_KEY ?? '';
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction && raw.trim().length === 0) {
      throw new Error(
        'CREDENTIAL_ENCRYPTION_KEY must be set in production. Refusing to boot with secret pass-through encryption.',
      );
    }

    if (raw.trim().length === 0) {
      // Dev/test fallback: per-process random key. Useless across processes
      // — only safe because the production guard above rules out prod.
      this.key = randomBytes(KEY_LENGTH);

      this.logger.warn(
        'CREDENTIAL_ENCRYPTION_KEY not set; using ephemeral per-process key (non-production only). Worker will fail to decrypt rows encrypted by BE.',
      );
    } else {
      this.key = createHash('sha256').update(raw, 'utf8').digest();
    }

    const hashRaw =
      process.env.CREDENTIAL_APP_KEY_HASH_SECRET ?? process.env.CREDENTIAL_ENCRYPTION_KEY ?? '';

    if (isProduction && hashRaw.trim().length === 0) {
      throw new Error(
        'CREDENTIAL_APP_KEY_HASH_SECRET or CREDENTIAL_ENCRYPTION_KEY must be set in production',
      );
    }

    this.appKeyHashSecret = hashRaw.trim() || 'development-app-key-hash-secret';
  }

  // Mirrors BE EncryptionService.decryptSecret. Returns null for
  // null/undefined/empty input so callers can pass nullable columns
  // directly. Throws on malformed ciphertext — that almost always means
  // a key mismatch with BE, which is a misconfig worth crashing on.
  decrypt(ciphertext: string | null | undefined): string | null {
    if (ciphertext === null || ciphertext === undefined || ciphertext === '') {
      return null;
    }

    if (!ciphertext.startsWith(VERSION_PREFIX)) {
      throw new Error('ciphertext missing version prefix');
    }

    const body = ciphertext.slice(VERSION_PREFIX.length);
    const parts = body.split(':');

    if (parts.length !== 3) {
      throw new Error('ciphertext malformed');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const data = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);

    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);

    return plaintext.toString('utf8');
  }

  // HMAC-SHA-256 of the trimmed app key. Matches BE's appKey hash so
  // worker can locate the same row via `app_key_hash` column.
  hashAppKey(appKey: string | null | undefined): string | null {
    const normalized = appKey?.trim();

    if (!normalized) return null;

    return createHmac('sha256', this.appKeyHashSecret).update(normalized, 'utf8').digest('hex');
  }
}
