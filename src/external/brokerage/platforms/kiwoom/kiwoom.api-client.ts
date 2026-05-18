import { Logger } from '@nestjs/common';
import { IntegrationError } from '@common/error/domain.error';
import type { BrokerageVendorProfile } from '../../brokerage.token';
import type { RateLimiter } from '../../service/rate-limiter.service';

// Token supplier resolves the bearer access token for THIS call. Collector
// profile binds a lambda that asks CredentialSourceService for the next
// collector credential + AccessTokenCacheService for its token. Executor
// profile binds a lambda that captures the accountId and asks for the
// account-scoped credential. Either way the api-client just calls
// `tokenSupplier()` — it never sees the appKey/appSecret material.
export type KiwoomTokenSupplier = () => Promise<string>;

export interface KiwoomApiClientOptions {
  readonly profile: BrokerageVendorProfile;
  readonly restUrl?: string;
  readonly tokenSupplier: KiwoomTokenSupplier;
  readonly rateLimiter: RateLimiter;
}

export interface KiwoomRequestOptions<TRequest> {
  readonly apiId: string;
  // Kiwoom REST path beneath the `${restUrl}`. Callers explicitly pass the
  // category path (`/api/dostk/ordr`, `/api/dostk/acnt`, `/api/dostk/chart`,
  // `/api/dostk/mrkcond`) because the apiId → path mapping is not 1:1 and
  // a single mistyped category turns into a confusing 404 rather than a
  // typed error. Keeping this explicit makes the call sites self-document.
  readonly endpointPath: string;
  readonly body: TRequest;
  readonly contYn?: 'Y' | 'N';
  readonly nextKey?: string;
}

// Single entry for all REST calls — concentrates rate-limit + auth in one place.
// Every call goes through rateLimiter.run(...) and tokenSupplier() — those
// two are the load-bearing invariants that keep collector and executor
// isolated.
export class KiwoomApiClient {
  private readonly logger: Logger;

  constructor(private readonly opts: KiwoomApiClientOptions) {
    this.logger = new Logger(`KiwoomApiClient[${opts.profile}]`);
  }

  get profile(): BrokerageVendorProfile {
    return this.opts.profile;
  }

  async request<TRequest, TResponse>(
    options: KiwoomRequestOptions<TRequest>,
  ): Promise<TResponse> {
    const { apiId, endpointPath, body, contYn, nextKey } = options;

    if (!this.opts.restUrl) {
      throw new IntegrationError('Kiwoom REST URL not configured', {
        profile: this.opts.profile,
        apiId,
      });
    }

    const restUrl = this.opts.restUrl.replace(/\/+$/, '');
    const path = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
    const url = `${restUrl}${path}`;

    return this.opts.rateLimiter.run(async () => {
      const token = await this.opts.tokenSupplier();

      let response: Response;

      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json;charset=UTF-8',
            authorization: `Bearer ${token}`,
            'api-id': apiId,
            'cont-yn': contYn ?? 'N',
            'next-key': nextKey ?? '',
          },
          body: JSON.stringify(body ?? {}),
        });
      } catch (err) {
        throw new IntegrationError(
          `Kiwoom REST network error apiId=${apiId}: ${err instanceof Error ? err.message : String(err)}`,
          { profile: this.opts.profile, apiId, endpointPath },
        );
      }

      let parsed: unknown;
      const rawText = await response.text();

      if (rawText) {
        try {
          parsed = JSON.parse(rawText);
        } catch (err) {
          throw new IntegrationError(
            `Kiwoom REST non-JSON response apiId=${apiId} status=${response.status}`,
            {
              profile: this.opts.profile,
              apiId,
              endpointPath,
              status: response.status,
              parseError: err instanceof Error ? err.message : String(err),
            },
          );
        }
      } else {
        parsed = {};
      }

      if (!response.ok) {
        const { returnCode, returnMsg } = extractReturnFields(parsed);

        throw new IntegrationError(
          `Kiwoom REST HTTP ${response.status} apiId=${apiId} returnCode=${String(returnCode ?? '')} returnMsg=${returnMsg ?? ''}`,
          {
            profile: this.opts.profile,
            apiId,
            endpointPath,
            status: response.status,
            returnCode,
            returnMsg,
          },
        );
      }

      const { returnCode, returnMsg } = extractReturnFields(parsed);

      // Kiwoom REST convention: 200 OK + return_code=0 means success.
      // Anything else is a vendor-level rejection that we surface as
      // IntegrationError so callers can map to OrderStatus.Rejected etc.
      if (returnCode !== undefined && returnCode !== null && returnCode !== 0 && returnCode !== '0') {
        throw new IntegrationError(
          `Kiwoom REST returned non-zero return_code apiId=${apiId} returnCode=${String(returnCode)} returnMsg=${returnMsg ?? ''}`,
          {
            profile: this.opts.profile,
            apiId,
            endpointPath,
            returnCode,
            returnMsg,
          },
        );
      }

      this.logger.debug(`apiId=${apiId} path=${path} status=${response.status} ok`);

      return parsed as TResponse;
    });
  }
}

function extractReturnFields(parsed: unknown): {
  returnCode: number | string | undefined;
  returnMsg: string | undefined;
} {
  if (!parsed || typeof parsed !== 'object') {
    return { returnCode: undefined, returnMsg: undefined };
  }

  const obj = parsed as Record<string, unknown>;
  const rc = obj.return_code;
  const rm = obj.return_msg;

  const returnCode =
    typeof rc === 'number' || typeof rc === 'string' ? rc : undefined;
  const returnMsg = typeof rm === 'string' ? rm : undefined;

  return { returnCode, returnMsg };
}
