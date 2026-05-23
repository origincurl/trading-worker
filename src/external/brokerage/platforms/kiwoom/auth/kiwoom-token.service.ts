import { Inject, Injectable, Logger } from '@nestjs/common';
import { IntegrationError } from '@common/error/domain.error';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import type { BrokerageCredentialMaterial } from '../../../credential/brokerage-credential-material';

export interface AccessTokenBundle {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly tokenExpiresAt: Date;
}

interface KiwoomTokenResponse {
  readonly token?: string;
  readonly expires_dt?: string;
  readonly return_code?: string | number | null;
  readonly return_msg?: string;
}

// Phase C: stateless vendor token service. Credential material is passed
// per-call so the same instance serves both collector- and account-scoped
// pools. Caching lives in AccessTokenCacheService — KiwoomTokenService
// is just an HTTP wrapper around /oauth2/token (issue + refresh + revoke).
//
// Kiwoom does NOT publish refresh / revoke endpoints in the spec we have
// access to; refresh degrades to a fresh issue, revoke is a no-op. Both
// preserve the AccessTokenCacheService contract so other vendors can
// implement the same shape later.
@Injectable()
export class KiwoomTokenService {
  private readonly logger = new Logger(KiwoomTokenService.name);

  private readonly issueTimeoutMs = 5_000;

  constructor(@Inject(KIWOOM_CONFIG) private readonly config: KiwoomConfig) {}

  async issueAccessToken(material: BrokerageCredentialMaterial): Promise<AccessTokenBundle> {
    if (!this.config.restUrl) {
      throw new IntegrationError('Kiwoom REST URL not configured', {
        credentialId: material.credentialId,
      });
    }

    const url = `${this.config.restUrl.replace(/\/$/, '')}/oauth2/token`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.issueTimeoutMs);

    let response: Response;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          appkey: material.appKey,
          secretkey: material.appSecret,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new IntegrationError(
        `Kiwoom /oauth2/token network failure: ${err instanceof Error ? err.message : String(err)}`,
        { credentialId: material.credentialId },
      );
    } finally {
      clearTimeout(timer);
    }

    const contentType = response.headers.get('content-type');
    const parsed = await safeJson(response);
    if (parsed === undefined) {
      throw new IntegrationError(
        'Kiwoom /oauth2/token returned non-JSON body (likely maintenance page)',
        {
          credentialId: material.credentialId,
          httpStatus: response.status,
          contentType,
        },
      );
    }
    const body: KiwoomTokenResponse =
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as KiwoomTokenResponse)
        : {};
    const returnCode =
      body.return_code === undefined || body.return_code === null ? null : String(body.return_code);

    if (!response.ok || (returnCode !== null && returnCode !== '0')) {
      throw new IntegrationError(
        body.return_msg ?? `Kiwoom token issue failed status=${response.status}`,
        {
          credentialId: material.credentialId,
          httpStatus: response.status,
          returnCode,
          returnMsg: body.return_msg,
        },
      );
    }

    if (!body.token) {
      throw new IntegrationError('Kiwoom token issue returned empty token', {
        credentialId: material.credentialId,
      });
    }

    const now = Date.now();
    const expiresAtMs = parseKiwoomExpiryMs(body.expires_dt) ?? now + 50 * 60_000;

    const ttlSec = Math.floor((expiresAtMs - now) / 1000);

    this.logger.log(
      `access token issued via /oauth2/token credentialId=${material.credentialId} expires=${body.expires_dt ?? '<unknown>'} ttl=${ttlSec}s`,
    );

    return {
      accessToken: body.token,
      tokenExpiresAt: new Date(expiresAtMs),
    };
  }

  // Kiwoom doesn't expose a documented refresh endpoint — re-issue
  // instead. Other vendors implementing the same surface area MAY use
  // the `current` bundle to send a real refresh_token request.
  async refreshAccessToken(
    material: BrokerageCredentialMaterial,
    _current: AccessTokenBundle,
  ): Promise<AccessTokenBundle> {
    return this.issueAccessToken(material);
  }

  // No-op for Kiwoom (no revoke endpoint). Kept on the interface so
  // higher layers can call it on credential rotation without branching.
  async revokeAccessToken(
    material: BrokerageCredentialMaterial,
    _current: AccessTokenBundle,
  ): Promise<void> {
    this.logger.debug(`revoke no-op for kiwoom credentialId=${material.credentialId}`);
  }
}

// Kiwoom expires_dt is wall-clock KST (`YYYYMMDDHHMMSS`). Convert to UTC
// epoch ms by interpreting the digits as KST then subtracting 9h.
function parseKiwoomExpiryMs(value: string | undefined): number | null {
  if (!value || !/^\d{14}$/.test(value)) return null;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = Number(value.slice(12, 14));
  const ms = Date.UTC(year, month - 1, day, hour, minute, second) - 9 * 60 * 60_000;

  return Number.isFinite(ms) ? ms : null;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
