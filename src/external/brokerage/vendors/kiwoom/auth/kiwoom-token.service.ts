import { Logger } from '@nestjs/common';
import { IntegrationError } from '@common/error/domain.error';

export interface KiwoomTokenServiceOptions {
  readonly profile: 'collector' | 'executor';
  readonly appKey: string;
  readonly appSecret: string;
  readonly restUrl?: string;
  // Reauthorize buffer — refresh `bufferSec` before expiry so the WS
  // LOGIN never sees a token within seconds of expiring.
  readonly bufferSec?: number;
  readonly tokenIssueTimeoutMs?: number;
}

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

interface KiwoomTokenResponse {
  readonly token?: string;
  readonly expires_dt?: string;
  readonly return_code?: string | number | null;
  readonly return_msg?: string;
}

// Issues access tokens via Kiwoom /oauth2/token using the role's
// long-lived app key/secret. Caches the result until expiry then
// silently refreshes. Logging never includes the token value or the
// appSecret — only state transitions (issued / refreshed / invalidated).
//
// LOGIN failure paths can call invalidateCache() to force a fresh issue
// on the next getAccessToken().
export class KiwoomTokenService {
  private readonly logger: Logger;

  private readonly issueTimeoutMs: number;

  private cached?: CachedToken;

  private inflight?: Promise<string>;

  constructor(private readonly opts: KiwoomTokenServiceOptions) {
    this.logger = new Logger(`KiwoomTokenService[${opts.profile}]`);

    this.issueTimeoutMs = opts.tokenIssueTimeoutMs ?? 5000;
  }

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    const buffer = (this.opts.bufferSec ?? 60) * 1000;

    if (this.cached && now + buffer < this.cached.expiresAtMs) {
      return this.cached.accessToken;
    }

    if (!this.inflight) {
      this.inflight = this.issue().finally(() => {
        this.inflight = undefined;
      });
    }

    return this.inflight;
  }

  // Force a refresh on next getAccessToken(). The WS LOGIN path calls
  // this when it sees a token-related Kiwoom return_code (e.g. 805004)
  // so the cached-but-server-rejected token is evicted and the next
  // attempt re-issues via /oauth2/token.
  invalidateCache(): void {
    if (!this.cached) return;

    this.cached = undefined;

    this.logger.warn('token cache invalidated — next call will re-issue');
  }

  // Test helper. Production callers should never invoke this — issuance
  // is automatic via getAccessToken(). Tests use it to inject a known
  // token without hitting the network.
  primeFromStaticToken(token: string, expiresAtMs: number): void {
    this.cached = { accessToken: token, expiresAtMs };

    this.logger.log(`token primed (expires=${new Date(expiresAtMs).toISOString()})`);
  }

  private async issue(): Promise<string> {
    if (!this.opts.restUrl) {
      throw new IntegrationError('Kiwoom REST URL not configured', {
        profile: this.opts.profile,
      });
    }

    if (!this.opts.appKey || !this.opts.appSecret) {
      throw new IntegrationError('Kiwoom appKey/appSecret missing — cannot issue token', {
        profile: this.opts.profile,
      });
    }

    const url = `${this.opts.restUrl.replace(/\/$/, '')}/oauth2/token`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.issueTimeoutMs);

    let response: Response;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          appkey: this.opts.appKey,
          secretkey: this.opts.appSecret,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new IntegrationError(
        `Kiwoom /oauth2/token network failure: ${err instanceof Error ? err.message : String(err)}`,
        { profile: this.opts.profile },
      );
    } finally {
      clearTimeout(timer);
    }

    const body = (await safeJson(response)) as KiwoomTokenResponse;
    const returnCode =
      body.return_code === undefined || body.return_code === null ? null : String(body.return_code);

    if (!response.ok || (returnCode !== null && returnCode !== '0')) {
      throw new IntegrationError(
        body.return_msg ?? `Kiwoom token issue failed status=${response.status}`,
        { profile: this.opts.profile, httpStatus: response.status, returnCode },
      );
    }

    if (!body.token) {
      throw new IntegrationError('Kiwoom token issue returned empty token', {
        profile: this.opts.profile,
      });
    }

    const now = Date.now();
    // expires_dt format: YYYYMMDDHHMMSS in KST. Fall back to 50min if
    // the field is missing — Kiwoom tokens are nominally 24h but we
    // refresh well before to stay drift-tolerant.
    const expiresAtMs = parseKiwoomExpiryMs(body.expires_dt) ?? now + 50 * 60_000;

    this.cached = { accessToken: body.token, expiresAtMs };

    const ttlSec = Math.floor((expiresAtMs - now) / 1000);

    this.logger.log(
      `access token issued via /oauth2/token expires=${body.expires_dt ?? '<unknown>'} ttl=${ttlSec}s`,
    );

    return body.token;
  }
}

// Kiwoom expires_dt is wall-clock KST (`YYYYMMDDHHMMSS`). Convert to
// UTC epoch ms by interpreting the digits as KST then subtracting 9h.
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
