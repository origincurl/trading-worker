import { Logger } from '@nestjs/common';
import { DomainError, IntegrationError } from '@common/error/domain.error';
import { redactPotentialSecrets } from '@common/util/redact.util';
import type { BrokerageVendorProfile } from '../../brokerage.token';
import type { RateLimiter } from '../../service/rate-limiter.service';
import type {
  CredentialUsageContext,
  CredentialUsageActionType,
  CredentialUsageOrigin,
  CredentialUsagePriority,
  CredentialUsageService,
} from '../../credential/credential-usage.service';
import type { CollectorCredentialLimitRepository } from '@shared/persistence/collector-credential/collector-credential-limit.repository';

const DEFAULT_REST_TIMEOUT_MS = 20_000;
const REST_RATE_LIMIT_BUCKET_MS = 1_000;
const REST_RATE_LIMIT_MIN_CAP_PER_SECOND = 1;
const MAX_COLLECTOR_REST_CREDENTIAL_ATTEMPTS = 3;

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
      readonly invalidate?: () => void;
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
  readonly usage?: {
    readonly origin?: CredentialUsageOrigin;
    readonly priority?: CredentialUsagePriority;
    readonly actionType?: CredentialUsageActionType;
    readonly endpointType?: string;
  };
  readonly meta?: Record<string, string | number | boolean | null | undefined>;
}

// Single entry for all REST calls — concentrates rate-limit + auth in one place.
// Every call goes through rateLimiter.run(...) and tokenSupplier() — those
// two are the load-bearing invariants that keep collector and executor
// isolated.
export class KiwoomApiClient {
  private readonly logger: Logger;

  private warnedMissingCredentialContext = false;
  private readonly adaptiveRestMeasuredRps = new Map<number, number>();
  private readonly adaptiveRestSecondBuckets = new Map<number, RestRateLimitBucket>();
  private readonly adaptiveRestQueues = new Map<number, Promise<void>>();
  private readonly adaptiveRestQueuedCounts = new Map<number, number>();
  private readonly adaptiveRestNextAvailableAtMs = new Map<number, number>();

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
    const restQueueContext: RestQueueContext = {
      endpoint: endpointLabel(endpointPath),
      usage: options.usage,
    };

    const resolveToken = tokenSupplier ?? this.opts.tokenSupplier;
    const initialTokenResult = normalizeTokenResult(await resolveToken());

    return this.opts.rateLimiter.run(async () => {
      let response: Response;

      const request = async (
        tokenResult: NormalizedKiwoomTokenResult,
        allowTokenRetry: boolean,
      ): Promise<TResponse> => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DEFAULT_REST_TIMEOUT_MS);
        let restAttempt: RestRateLimitAttempt | null = null;

        try {
          restAttempt = await this.waitForAdaptiveRestPacing(tokenResult.credential, restQueueContext);
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
          if (allowTokenRetry && shouldRetryWithFreshToken(tokenResult, returnCode, returnMsg)) {
            const nextTokenResult = await refreshTokenResult(resolveToken, tokenResult);

            if (nextTokenResult) return await request(nextTokenResult, false);
          }

          await this.recordFailedResponse(tokenResult.credential, {
            httpStatus: response.status,
            returnCode,
            returnMsg,
            retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
            apiId,
            endpointPath,
            restAttempt,
            restQueueContext,
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
          if (allowTokenRetry && shouldRetryWithFreshToken(tokenResult, returnCode, returnMsg)) {
            const nextTokenResult = await refreshTokenResult(resolveToken, tokenResult);

            if (nextTokenResult) return await request(nextTokenResult, false);
          }

          await this.recordRejectedResponse(tokenResult.credential, {
            returnCode,
            returnMsg,
            apiId,
            endpointPath,
            restAttempt,
            restQueueContext,
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
        let tokenResult = initialTokenResult;
        const attemptedCollectorCredentialIds = new Set<number>();

        for (let attempt = 1; attempt <= MAX_COLLECTOR_REST_CREDENTIAL_ATTEMPTS; attempt += 1) {
          const credentialId = collectorCredentialId(tokenResult.credential);
          if (credentialId !== null) attemptedCollectorCredentialIds.add(credentialId);

          try {
            const usageCredential = mergeUsageContext(tokenResult.credential, options.usage);
            if (usageCredential && this.opts.usage) {
              return await this.opts.usage.runRest(
                this.opts.profile,
                usageCredential,
                endpointLabel(endpointPath),
                () => request(tokenResult, true),
                { apiId, endpointPath: path, meta: options.meta },
              );
            }

            if (
              !tokenResult.credential &&
              this.opts.usage &&
              !this.warnedMissingCredentialContext
            ) {
              this.warnedMissingCredentialContext = true;

              this.logger.warn(
                `Kiwoom REST usage tracking skipped because token supplier returned no credential context apiId=${apiId} path=${path}`,
              );
            }

            return await request(tokenResult, true);
          } catch (err) {
            if (
              !this.shouldRetryWithNextCollectorCredential(
                err,
                tokenResult.credential,
                attempt,
              )
            ) {
              throw err;
            }

            const nextTokenResult = await this.nextCollectorTokenResult(
              resolveToken,
              attemptedCollectorCredentialIds,
            );
            if (!nextTokenResult) throw err;

            this.logger.warn(
              `Kiwoom REST retrying with next collector credential apiId=${apiId} path=${path}`,
            );
            tokenResult = nextTokenResult;
          }
        }

        return await request(tokenResult, true);
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
      readonly restAttempt: RestRateLimitAttempt | null;
      readonly restQueueContext: RestQueueContext;
    },
  ): Promise<void> {
    if (!this.isCollectorCredential(credential)) return;

    const reason = `REST ${input.endpointPath} apiId=${input.apiId} status=${input.httpStatus} returnCode=${String(input.returnCode ?? '')} returnMsg=${redactPotentialSecrets(input.returnMsg) ?? ''}`;

    if (input.httpStatus === 429 || looksRateLimited(input.returnCode, input.returnMsg)) {
      this.noteAdaptiveRestRateLimit(credential, input.restAttempt, input.apiId);
      this.publishAdaptiveRestQueueState(credential, input.restQueueContext);
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
        source: 'REST',
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
      readonly restAttempt: RestRateLimitAttempt | null;
      readonly restQueueContext: RestQueueContext;
    },
  ): Promise<void> {
    if (!this.isCollectorCredential(credential)) return;

    const reason = `REST ${input.endpointPath} apiId=${input.apiId} returnCode=${String(input.returnCode)} returnMsg=${redactPotentialSecrets(input.returnMsg) ?? ''}`;

    if (looksRateLimited(input.returnCode, input.returnMsg)) {
      this.noteAdaptiveRestRateLimit(credential, input.restAttempt, input.apiId);
      this.publishAdaptiveRestQueueState(credential, input.restQueueContext);
      await this.opts.collectorRuntimeState?.markRateLimited({
        credentialId: credential.credentialId,
        reason,
      });

      return;
    }

    if (looksAuthFailed(input.returnCode, input.returnMsg)) {
      await this.opts.collectorRuntimeState?.markAuthFailed({
        credentialId: credential.credentialId,
        source: 'REST',
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

  private shouldRetryWithNextCollectorCredential(
    err: unknown,
    credential: CredentialUsageContext | null,
    attempt: number,
  ): boolean {
    return (
      attempt < MAX_COLLECTOR_REST_CREDENTIAL_ATTEMPTS &&
      this.isCollectorCredential(credential) &&
      isKiwoomRestRateLimitError(err)
    );
  }

  private async nextCollectorTokenResult(
    resolveToken: KiwoomTokenSupplier,
    attemptedCredentialIds: ReadonlySet<number>,
  ): Promise<NormalizedKiwoomTokenResult | null> {
    for (let i = 0; i < MAX_COLLECTOR_REST_CREDENTIAL_ATTEMPTS; i += 1) {
      const next = normalizeTokenResult(await resolveToken());
      const credentialId = collectorCredentialId(next.credential);
      if (credentialId === null || attemptedCredentialIds.has(credentialId)) continue;

      return next;
    }

    return null;
  }

  private async waitForAdaptiveRestPacing(
    credential: CredentialUsageContext | null,
    context: RestQueueContext,
  ): Promise<RestRateLimitAttempt | null> {
    if (!this.isCollectorCredential(credential)) return null;

    const credentialId = credential.credentialId;
    const previous = this.adaptiveRestQueues.get(credentialId) ?? Promise.resolve();
    let attempt: RestRateLimitAttempt | null = null;

    this.incrementAdaptiveRestQueued(credentialId, credential, context);

    const current = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          while (true) {
            const measuredRps = this.adaptiveRestMeasuredRps.get(credentialId);
            if (!measuredRps) break;

            const now = Date.now();
            const second = Math.floor(now / REST_RATE_LIMIT_BUCKET_MS);
            const bucket = this.adaptiveRestSecondBuckets.get(credentialId);
            if (!bucket || bucket.second !== second || bucket.count < measuredRps) break;

            const nextSecondAt = (second + 1) * REST_RATE_LIMIT_BUCKET_MS;
            this.adaptiveRestNextAvailableAtMs.set(credentialId, nextSecondAt);
            this.publishAdaptiveRestQueueState(credential, context);
            await sleep(Math.max(1, nextSecondAt - now));
          }

          const now = Date.now();
          const second = Math.floor(now / REST_RATE_LIMIT_BUCKET_MS);
          const bucket = this.adaptiveRestSecondBuckets.get(credentialId);
          const nextBucket =
            bucket && bucket.second === second
              ? { second, count: bucket.count + 1 }
              : { second, count: 1 };

          this.adaptiveRestSecondBuckets.set(credentialId, nextBucket);
          attempt = nextBucket;

          const measuredRps = this.adaptiveRestMeasuredRps.get(credentialId);
          this.adaptiveRestNextAvailableAtMs.set(
            credentialId,
            measuredRps && nextBucket.count >= measuredRps
              ? (second + 1) * REST_RATE_LIMIT_BUCKET_MS
              : now,
          );
        } finally {
          this.decrementAdaptiveRestQueued(credentialId, credential, context);
        }
      });

    let queued: Promise<void>;
    queued = current.finally(() => {
      if (this.adaptiveRestQueues.get(credentialId) === queued) {
        this.adaptiveRestQueues.delete(credentialId);
      }
    });

    this.adaptiveRestQueues.set(credentialId, queued);

    await current;

    return attempt;
  }

  private noteAdaptiveRestRateLimit(
    credential: CredentialUsageContext,
    attempt: RestRateLimitAttempt | null,
    apiId: string,
  ): void {
    if (!attempt) return;

    const credentialId = credential.credentialId;
    const measuredCap = Math.max(REST_RATE_LIMIT_MIN_CAP_PER_SECOND, attempt.count - 1);
    const current = this.adaptiveRestMeasuredRps.get(credentialId);
    const next = current ? Math.min(current, measuredCap) : measuredCap;

    this.adaptiveRestMeasuredRps.set(credentialId, next);
    const bucket = this.adaptiveRestSecondBuckets.get(credentialId);
    if (bucket) this.adaptiveRestNextAvailableAtMs.set(credentialId, (bucket.second + 1) * REST_RATE_LIMIT_BUCKET_MS);
    this.logger.warn(
      `adaptive REST cap credentialId=${credentialId} measuredRps=${next}/s rateLimitedAtCount=${attempt.count} apiId=${apiId}`,
    );
  }

  private incrementAdaptiveRestQueued(
    credentialId: number,
    credential: CredentialUsageContext,
    context: RestQueueContext,
  ): void {
    this.adaptiveRestQueuedCounts.set(
      credentialId,
      (this.adaptiveRestQueuedCounts.get(credentialId) ?? 0) + 1,
    );
    this.publishAdaptiveRestQueueState(credential, context);
  }

  private decrementAdaptiveRestQueued(
    credentialId: number,
    credential: CredentialUsageContext,
    context: RestQueueContext,
  ): void {
    this.adaptiveRestQueuedCounts.set(
      credentialId,
      Math.max(0, (this.adaptiveRestQueuedCounts.get(credentialId) ?? 0) - 1),
    );
    this.publishAdaptiveRestQueueState(credential, context);
  }

  private publishAdaptiveRestQueueState(
    credential: CredentialUsageContext,
    context: RestQueueContext,
  ): void {
    if (!this.opts.usage) return;

    const credentialId = credential.credentialId;
    const bucket = this.adaptiveRestSecondBuckets.get(credentialId);
    const usageCredential = mergeUsageContext(credential, context.usage) ?? credential;

    this.opts.usage.markRestQueueState(this.opts.profile, usageCredential, context.endpoint, {
      measuredRps: this.adaptiveRestMeasuredRps.get(credentialId) ?? null,
      bucketSecond: bucket?.second ?? null,
      bucketCount: bucket?.count ?? 0,
      queued: this.adaptiveRestQueuedCounts.get(credentialId) ?? 0,
      nextAvailableAtMs: this.adaptiveRestNextAvailableAtMs.get(credentialId) ?? null,
    });
  }
}

type NormalizedKiwoomTokenResult = {
  readonly token: string;
  readonly credential: CredentialUsageContext | null;
  readonly invalidate?: () => void;
};

type RestRateLimitBucket = {
  readonly second: number;
  readonly count: number;
};

type RestRateLimitAttempt = RestRateLimitBucket;

type RestQueueContext = {
  readonly endpoint: string;
  readonly usage: KiwoomRequestOptions<unknown>['usage'];
};

export function normalizeTokenResult(value: KiwoomTokenResult): NormalizedKiwoomTokenResult {
  if (typeof value === 'string') {
    return { token: value, credential: null };
  }

  return { token: value.token, credential: value.credential, invalidate: value.invalidate };
}

function endpointLabel(endpointPath: string): string {
  if (endpointPath.includes('/ordr')) return 'REST_ORDER';
  if (endpointPath.includes('/acnt')) return 'REST_ACCOUNT';
  if (endpointPath.includes('/chart')) return 'REST_CHART';
  if (endpointPath.includes('/sect')) return 'REST_MARKET_STATS';
  if (endpointPath.includes('/mrkcond')) return 'REST_MARKET_STATS';

  return endpointPath;
}

function collectorCredentialId(credential: CredentialUsageContext | null): number | null {
  return credential?.kind === 'collector' ? credential.credentialId : null;
}

function isKiwoomRestRateLimitError(err: unknown): boolean {
  if (!(err instanceof IntegrationError)) return false;

  const details = err.details ?? {};
  if (details.status === 429) return true;

  const returnCode = details.returnCode;
  const returnMsg = details.returnMsg;

  return looksRateLimited(
    typeof returnCode === 'string' || typeof returnCode === 'number' ? returnCode : undefined,
    typeof returnMsg === 'string' ? returnMsg : undefined,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeUsageContext(
  credential: CredentialUsageContext | null,
  usage: KiwoomRequestOptions<unknown>['usage'],
): CredentialUsageContext | null {
  if (!credential) return null;

  return {
    ...credential,
    ...usage,
  };
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

function looksTokenRejected(
  returnCode: number | string | undefined,
  returnMsg: string | undefined,
): boolean {
  const haystack = `${String(returnCode ?? '')} ${returnMsg ?? ''}`.toLowerCase();

  return (
    haystack.includes('token') ||
    haystack.includes('토큰') ||
    haystack.includes('expired') ||
    haystack.includes('만료')
  );
}

function shouldRetryWithFreshToken(
  tokenResult: NormalizedKiwoomTokenResult,
  returnCode: number | string | undefined,
  returnMsg: string | undefined,
): boolean {
  return Boolean(tokenResult.invalidate && looksTokenRejected(returnCode, returnMsg));
}

async function refreshTokenResult(
  resolveToken: KiwoomTokenSupplier,
  current: NormalizedKiwoomTokenResult,
): Promise<NormalizedKiwoomTokenResult | null> {
  current.invalidate?.();

  const next = normalizeTokenResult(await resolveToken());
  if (!next.token || next.token === current.token) return null;

  return next;
}
