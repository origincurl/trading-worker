import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  KiwoomTokenService,
  type AccessTokenBundle,
} from '../platforms/kiwoom/auth/kiwoom-token.service';
import { redactPotentialSecrets } from '@common/util/redact.util';
import type { BrokerageCredentialMaterial } from '../credential/brokerage-credential-material';
import { CredentialCooldownService } from '../credential/credential-cooldown.service';
import { COLLECTOR_CREDENTIAL_LIMIT_REPOSITORY } from '@shared/persistence/collector-credential/collector-credential-limit.token';
import type { CollectorCredentialLimitRepository } from '@shared/persistence/collector-credential/collector-credential-limit.repository';

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
    @Inject(COLLECTOR_CREDENTIAL_LIMIT_REPOSITORY)
    private readonly collectorRuntimeState: CollectorCredentialLimitRepository,
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
      await this.markCollectorSuccess(material);

      return bundle.accessToken;
    } catch (err) {
      // Refresh path: fall through to a fresh issue on the assumption
      // the refresh token is stale / vendor doesn't support refresh.
      if (existing) {
        this.cache.delete(material.credentialId);

        try {
          const bundle = await this.tokenService.issueAccessToken(material);

          this.cache.set(material.credentialId, { material, bundle });
          await this.markCollectorSuccess(material);

          return bundle.accessToken;
        } catch (issueErr) {
          this.cooldown.setCooldown(
            material.credentialId,
            AUTH_FAIL_COOLDOWN_MS,
            redactPotentialSecrets(
              issueErr instanceof Error ? issueErr.message : String(issueErr),
            ) ?? 'token issue failed',
          );
          await this.markCollectorFailure(material, issueErr);

          throw issueErr;
        }
      }

      this.cooldown.setCooldown(
        material.credentialId,
        AUTH_FAIL_COOLDOWN_MS,
        redactPotentialSecrets(err instanceof Error ? err.message : String(err)) ??
          'token issue failed',
      );
      await this.markCollectorFailure(material, err);

      throw err;
    }
  }

  private async markCollectorFailure(
    material: BrokerageCredentialMaterial,
    err: unknown,
  ): Promise<void> {
    if (material.kind !== 'collector') return;

    if (isBrokerRateLimited(err)) {
      await this.collectorRuntimeState.markRateLimited({
        credentialId: material.credentialId,
        reason: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (!isBrokerAuthFailure(err)) return;

    await this.collectorRuntimeState.markAuthFailed({
      credentialId: material.credentialId,
      source: 'TOKEN',
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  private async markCollectorSuccess(material: BrokerageCredentialMaterial): Promise<void> {
    if (material.kind !== 'collector') return;

    await this.collectorRuntimeState.markSuccess({
      credentialId: material.credentialId,
      source: 'TOKEN',
    });
  }
}

function isBrokerRateLimited(err: unknown): boolean {
  if (!(err instanceof Error) || !('details' in err)) return false;

  const details = err.details as Record<string, unknown> | undefined;
  const httpStatus = details?.httpStatus;
  const returnCode = String(details?.returnCode ?? '').toLowerCase();
  const returnMsg = typeof details?.returnMsg === 'string' ? details.returnMsg.toLowerCase() : '';
  const message = err.message.toLowerCase();
  const haystack = `${returnCode} ${returnMsg} ${message}`;

  return (
    httpStatus === 429 ||
    haystack.includes('rate') ||
    haystack.includes('limit') ||
    haystack.includes('too many') ||
    haystack.includes('429') ||
    haystack.includes('초과') ||
    haystack.includes('과다')
  );
}

function isBrokerAuthFailure(err: unknown): boolean {
  if (!(err instanceof Error) || !('details' in err)) return false;

  const details = err.details as Record<string, unknown> | undefined;
  const httpStatus = details?.httpStatus;
  const returnCode = String(details?.returnCode ?? '').toLowerCase();
  const returnMsg = typeof details?.returnMsg === 'string' ? details.returnMsg.toLowerCase() : '';
  const message = err.message.toLowerCase();
  const haystack = `${returnCode} ${returnMsg} ${message}`;

  return (
    httpStatus === 401 ||
    httpStatus === 403 ||
    haystack.includes('auth') ||
    haystack.includes('token') ||
    haystack.includes('invalid') ||
    haystack.includes('unauthorized') ||
    haystack.includes('인증') ||
    haystack.includes('토큰')
  );
}
