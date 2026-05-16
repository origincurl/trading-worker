import { Logger } from '@nestjs/common';
import { IntegrationError, NotImplementedError } from '@common/error/domain.error';

export interface KiwoomTokenServiceOptions {
  readonly profile: 'collector' | 'executor';
  readonly appKey: string;
  readonly appSecret: string;
  readonly restUrl?: string;
  // Reauthorize buffer — refresh `bufferSec` before expiry.
  readonly bufferSec?: number;
  // Phase 6 bootstrap: pre-issued static token from env. When set,
  // getAccessToken returns this until expiry without hitting /oauth2/token.
  // Real issuance + refresh land in Phase 6.8.
  readonly staticToken?: string;
  readonly staticTokenTtlSec?: number;
}

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

// Phase 3: skeleton only. Phase 6/8 wires the real /oauth2/token request.
// The contract here is: callers call getAccessToken(), service caches +
// refreshes silently before expiry, never logs the secret or token value.
export class KiwoomTokenService {
  private readonly logger: Logger;

  private cached?: CachedToken;

  private inflight?: Promise<string>;

  constructor(private readonly opts: KiwoomTokenServiceOptions) {
    this.logger = new Logger(`KiwoomTokenService[${opts.profile}]`);

    if (opts.staticToken && opts.staticToken.length > 0) {
      const ttlSec = opts.staticTokenTtlSec ?? 24 * 60 * 60;

      this.cached = {
        accessToken: opts.staticToken,
        expiresAtMs: Date.now() + ttlSec * 1_000,
      };

      this.logger.log(`token primed from env (ttl=${ttlSec}s)`);
    }
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

  // Stub. Real impl will POST `${restUrl}/oauth2/token` with appKey/appSecret
  // and store the response. Until then the gateway must not be invoked.
  private async issue(): Promise<string> {
    if (!this.opts.restUrl) {
      throw new IntegrationError('Kiwoom REST URL not configured', {
        profile: this.opts.profile,
      });
    }

    throw new NotImplementedError('KiwoomTokenService.issue is not implemented yet', {
      profile: this.opts.profile,
    });
  }

  // Test-only / Phase 6 bootstrap hook: lets a known-good token be injected
  // without hitting the network. Never log the value.
  primeFromStaticToken(token: string, expiresAtMs: number): void {
    this.cached = { accessToken: token, expiresAtMs };

    this.logger.log(`token primed (expires=${new Date(expiresAtMs).toISOString()})`);
  }
}
