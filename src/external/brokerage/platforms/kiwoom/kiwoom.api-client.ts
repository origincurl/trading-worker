import { Logger } from '@nestjs/common';
import { DomainError, IntegrationError } from '@common/error/domain.error';
import { redactPotentialSecrets } from '@common/util/redact.util';
import type { BrokerageVendorProfile } from '../../brokerage.token';
import type { RateLimiter } from '../../service/rate-limiter.service';
import type {
  CredentialUsageContext,
  CredentialUsageService,
} from '../../credential/credential-usage.service';
import type { CollectorCredentialLimitRepository } from '@shared/persistence/collector-credential/collector-credential-limit.repository';

const DEFAULT_REST_TIMEOUT_MS = 20_000;

// Token supplier resolves the bearer access token for THIS call. Collector
// profile binds a lambda that asks CredentialSourceService for the next
// collector credential + AccessTokenCacheService for its token. Executor
// profile binds a lambda that captures the accountId and asks for the
// account-scoped credential. Either way the api-client just calls
// `tokenSupplier()` — it never sees the appKey/appSecret material.
export type KiwoomTokenResult =
  | string
  | {
      readonly token: string;
      readonly credential: CredentialUsageContext;
    };

export type KiwoomTokenSupplier = () => Promise<KiwoomTokenResult>;

export interface KiwoomApiClientOptions {
  readonly profile: BrokerageVendorProfile;
  readonly restUrl?: string;
  readonly tokenSupplier: KiwoomTokenSupplier;
  readonly rateLimiter: RateLimiter;
  readonly usage?: CredentialUsageService;
  readonly collectorRuntimeState?: CollectorCredentialLimitRepository;
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
  readonly tokenSupplier?: KiwoomTokenSupplier;
}

// Single entry for all REST calls — concentrates rate-limit + auth in one place.
// Every call goes through rateLimiter.run(...) and tokenSupplier() — those
// two are the load-bearing invariants that keep collector and executor
// isolated.
export class KiwoomApiClient {
  private readonly logger: Logger;

  private warnedMissingCredentialContext = false;

  constructor(private readonly opts: KiwoomApiClientOptions) {
    this.logger = new Logger(`KiwoomApiClient[${opts.profile}]`);
  }

  get profile(): BrokerageVendorProfile {
    return this.opts.profile;
  }

  async request<TRequest, TResponse>(options: KiwoomRequestOptions<TRequest>): Promise<TResponse> {
    const { apiId, endpointPath, body, contYn, nextKey, tokenSupplier } = options;

    if (!this.opts.restUrl) {
      throw new IntegrationError('Kiwoom REST URL not configured', {
        profile: this.opts.profile,
        apiId,
      });
    }

    const restUrl = this.opts.restUrl.replace(/\/+$/, '');
    const path = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
    const url = `${restUrl}${path}`;

    const tokenResult = normalizeTokenResult(await (tokenSupplier ?? this.opts.tokenSupplier)());

    return this.opts.rateLimiter.run(async () => {
      let response: Response;

      const request = async (): Promise<TResponse> => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DEFAULT_REST_TIMEOUT_MS);

        try {
          response = await fetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json;charset=UTF-8',
              authorization: `Bearer ${tokenResult.token}`,
              'api-id': apiId,
              'cont-yn': contYn ?? 'N',
              'next-key': nextKey ?? '',
            },
            body: JSON.stringify(body ?? {}),
            signal: controller.signal,
          });
        } catch (err) {
          if (controller.signal.aborted) {
            throw new IntegrationError(`Kiwoom REST timeout apiId=${apiId}`, {
              profile: this.opts.profile,
              apiId,
              endpointPath,
              timeoutMs: DEFAULT_REST_TIMEOUT_MS,
            });
          }

          throw err;
        } finally {
          clearTimeout(timeout);
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
          await this.recordFailedResponse(tokenResult.credential, {
            httpStatus: response.status,
            returnCode,
            returnMsg,
            retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
            apiId,
            endpointPath,
          });

          throw new IntegrationError(
            `Kiwoom REST HTTP ${response.status} apiId=${apiId} returnCode=${String(returnCode ?? '')} returnMsg=${redactPotentialSecrets(returnMsg) ?? ''}`,
            {
              profile: this.opts.profile,
              apiId,
              endpointPath,
              status: response.status,
              returnCode,
              returnMsg: redactPotentialSecrets(returnMsg),
            },
          );
        }

        const { returnCode, returnMsg } = extractReturnFields(parsed);

        // Kiwoom REST convention: 200 OK + return_code=0 means success.
        // Anything else is a vendor-level rejection that we surface as
        // IntegrationError so callers can map to OrderStatus.Rejected etc.
        if (
          returnCode !== undefined &&
          returnCode !== null &&
          returnCode !== 0 &&
          returnCode !== '0'
        ) {
          await this.recordRejectedResponse(tokenResult.credential, {
            returnCode,
            returnMsg,
            apiId,
            endpointPath,
          });

          throw new IntegrationError(
            `Kiwoom REST returned non-zero return_code apiId=${apiId} returnCode=${String(returnCode)} returnMsg=${redactPotentialSecrets(returnMsg) ?? ''}`,
            {
              profile: this.opts.profile,
              apiId,
              endpointPath,
              returnCode,
              returnMsg: redactPotentialSecrets(returnMsg),
            },
          );
        }

        await this.recordSuccess(tokenResult.credential);

        this.logger.debug(`apiId=${apiId} path=${path} status=${response.status} ok`);

        return parsed as TResponse;
      };

      try {
        if (tokenResult.credential && this.opts.usage) {
          return await this.opts.usage.runRest(
            this.opts.profile,
            tokenResult.credential,
            endpointLabel(endpointPath),
            request,
          );
        }

        if (!tokenResult.credential && this.opts.usage && !this.warnedMissingCredentialContext) {
          this.warnedMissingCredentialContext = true;
          this.logger.warn(
            `Kiwoom REST usage tracking skipped because token supplier returned no credential context apiId=${apiId} path=${path}`,
          );
        }

        return await request();
      } catch (err) {
        if (err instanceof DomainError) throw err;

        throw new IntegrationError(
          `Kiwoom REST network error apiId=${apiId}: ${err instanceof Error ? err.message : String(err)}`,
          { profile: this.opts.profile, apiId, endpointPath },
        );
      }
    });
  }

  private async recordFailedResponse(
    credential: CredentialUsageContext | null,
    input: {
      readonly httpStatus: number;
      readonly returnCode: number | string | undefined;
      readonly returnMsg: string | undefined;
      readonly retryAfterMs: number | null;
      readonly apiId: string;
      readonly endpointPath: string;
    },
  ): Promise<void> {
    if (!this.isCollectorCredential(credential)) return;

    const reason = `REST ${input.endpointPath} apiId=${input.apiId} status=${input.httpStatus} returnCode=${String(input.returnCode ?? '')} returnMsg=${redactPotentialSecrets(input.returnMsg) ?? ''}`;

    if (input.httpStatus === 429 || looksRateLimited(input.returnCode, input.returnMsg)) {
      await this.opts.collectorRuntimeState?.markRateLimited({
        credentialId: credential.credentialId,
        retryAfterMs: input.retryAfterMs,
        reason,
      });
      return;
    }

    if (input.httpStatus === 401 || input.httpStatus === 403) {
      await this.opts.collectorRuntimeState?.markAuthFailed({
        credentialId: credential.credentialId,
        reason,
      });
    }
  }

  private async recordRejectedResponse(
    credential: CredentialUsageContext | null,
    input: {
      readonly returnCode: number | string;
      readonly returnMsg: string | undefined;
      readonly apiId: string;
      readonly endpointPath: string;
    },
  ): Promise<void> {
    if (!this.isCollectorCredential(credential)) return;

    const reason = `REST ${input.endpointPath} apiId=${input.apiId} returnCode=${String(input.returnCode)} returnMsg=${redactPotentialSecrets(input.returnMsg) ?? ''}`;

    if (looksRateLimited(input.returnCode, input.returnMsg)) {
      await this.opts.collectorRuntimeState?.markRateLimited({
        credentialId: credential.credentialId,
        reason,
      });
      return;
    }

    if (looksAuthFailed(input.returnCode, input.returnMsg)) {
      await this.opts.collectorRuntimeState?.markAuthFailed({
        credentialId: credential.credentialId,
        reason,
      });
    }
  }

  private async recordSuccess(credential: CredentialUsageContext | null): Promise<void> {
    if (!this.isCollectorCredential(credential)) return;

    await this.opts.collectorRuntimeState?.markSuccess({
      credentialId: credential.credentialId,
      source: 'REST',
    });
  }

  private isCollectorCredential(
    credential: CredentialUsageContext | null,
  ): credential is CredentialUsageContext {
    return credential?.kind === 'collector';
  }
}

export function normalizeTokenResult(value: KiwoomTokenResult): {
  readonly token: string;
  readonly credential: CredentialUsageContext | null;
} {
  if (typeof value === 'string') {
    return { token: value, credential: null };
  }

  return { token: value.token, credential: value.credential };
}

function endpointLabel(endpointPath: string): string {
  if (endpointPath.includes('/ordr')) return 'REST_ORDER';
  if (endpointPath.includes('/acnt')) return 'REST_ACCOUNT';
  if (endpointPath.includes('/chart')) return 'REST_CHART';
  if (endpointPath.includes('/mrkcond')) return 'REST_MARKET_STATS';

  return endpointPath;
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

  const returnCode = typeof rc === 'number' || typeof rc === 'string' ? rc : undefined;
  const returnMsg = typeof rm === 'string' ? rm : undefined;

  return { returnCode, returnMsg };
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1000);

  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return null;

  return Math.max(0, dateMs - Date.now());
}

function looksRateLimited(
  returnCode: number | string | undefined,
  returnMsg: string | undefined,
): boolean {
  const haystack = `${String(returnCode ?? '')} ${returnMsg ?? ''}`.toLowerCase();

  return (
    haystack.includes('rate') ||
    haystack.includes('limit') ||
    haystack.includes('too many') ||
    haystack.includes('429') ||
    haystack.includes('초과') ||
    haystack.includes('과다')
  );
}

function looksAuthFailed(
  returnCode: number | string | undefined,
  returnMsg: string | undefined,
): boolean {
  const haystack = `${String(returnCode ?? '')} ${returnMsg ?? ''}`.toLowerCase();

  return (
    haystack.includes('auth') ||
    haystack.includes('token') ||
    haystack.includes('invalid') ||
    haystack.includes('unauthorized') ||
    haystack.includes('인증') ||
    haystack.includes('토큰')
  );
}
