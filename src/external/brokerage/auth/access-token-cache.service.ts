import { Injectable, Logger } from '@nestjs/common';
import {
  KiwoomTokenService,
  type AccessTokenBundle,
} from '../platforms/kiwoom/auth/kiwoom-token.service';
import type { BrokerageCredentialMaterial } from '../credential/brokerage-credential-material';
import { CredentialCooldownService } from '../credential/credential-cooldown.service';

const REFRESH_BUFFER_MS = 5 * 60_000;
const AUTH_FAIL_COOLDOWN_MS = 5 * 60_000;

interface CachedEntry {
  readonly material: BrokerageCredentialMaterial;
  readonly bundle: AccessTokenBundle;
}

// In-memory access-token cache keyed by credentialId. Issues on first
// access, refreshes when ≤5min before expiry, falls back to re-issue on
// refresh failure. On hard auth failure the credential is pushed onto
// CredentialCooldownService so the source service skips it next round.
@Injectable()
export class AccessTokenCacheService {
  private readonly logger = new Logger(AccessTokenCacheService.name);

  private readonly cache = new Map<number, CachedEntry>();

  private readonly inflight = new Map<number, Promise<string>>();

  constructor(
    private readonly tokenService: KiwoomTokenService,
    private readonly cooldown: CredentialCooldownService,
  ) {}

  // Returns a valid access token for `material.credentialId`. If a cache
  // entry exists for the same credentialId, it MUST have been issued for
  // the same material — callers always pass the freshly-selected material
  // so the credential's appKey/appSecret stay consistent across calls.
  async getAccessToken(material: BrokerageCredentialMaterial): Promise<string> {
    const existing = this.cache.get(material.credentialId);
    const now = Date.now();

    if (existing && existing.bundle.tokenExpiresAt.getTime() - now > REFRESH_BUFFER_MS) {
      return existing.bundle.accessToken;
    }

    const inflight = this.inflight.get(material.credentialId);

    if (inflight) return inflight;

    const promise = this.issueOrRefresh(material, existing).finally(() => {
      this.inflight.delete(material.credentialId);
    });

    this.inflight.set(material.credentialId, promise);

    return promise;
  }

  invalidate(credentialId: number): void {
    if (this.cache.delete(credentialId)) {
      this.logger.warn(`access-token cache invalidated credentialId=${credentialId}`);
    }
  }

  private async issueOrRefresh(
    material: BrokerageCredentialMaterial,
    existing: CachedEntry | undefined,
  ): Promise<string> {
    try {
      const bundle = existing
        ? await this.tokenService.refreshAccessToken(material, existing.bundle)
        : await this.tokenService.issueAccessToken(material);

      this.cache.set(material.credentialId, { material, bundle });

      return bundle.accessToken;
    } catch (err) {
      // Refresh path: fall through to a fresh issue on the assumption
      // the refresh token is stale / vendor doesn't support refresh.
      if (existing) {
        this.cache.delete(material.credentialId);

        try {
          const bundle = await this.tokenService.issueAccessToken(material);

          this.cache.set(material.credentialId, { material, bundle });

          return bundle.accessToken;
        } catch (issueErr) {
          this.cooldown.setCooldown(
            material.credentialId,
            AUTH_FAIL_COOLDOWN_MS,
            issueErr instanceof Error ? issueErr.message : String(issueErr),
          );

          throw issueErr;
        }
      }

      this.cooldown.setCooldown(
        material.credentialId,
        AUTH_FAIL_COOLDOWN_MS,
        err instanceof Error ? err.message : String(err),
      );

      throw err;
    }
  }
}
