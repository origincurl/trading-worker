import { Logger } from '@nestjs/common';
import type { AcquireRateLimitResponseContract } from '../contract/response/acquire-rate-limit.response';
import type { LeaseCredentialResponseContract } from '../contract/response/lease-credential.response';
import type { PickupJobResponseContract } from '../contract/response/pickup-job.response';
import type { AcquireRateLimitResult, BeCallResult, PickupResult } from '../model/be-result.model';
import type { ChartBackfillOutcomePayload } from '../model/chart-backfill-lease.model';
import type { CredentialLeaseModel } from '../model/credential-lease.model';
import type { UniverseLeaseModel } from '../model/universe-lease.model';
import { BeNetworkError } from './be-control-plane.errors';
import { BeControlPlaneSigner } from './be-control-plane.signer';
import type {
  AcquireChartBackfillLeaseInput,
  AcquireChartBackfillLeaseResult,
  AcquireRateLimitInput,
  BeControlPlaneClient,
  FetchUniverseLeaseInput,
  LeaseCredentialInput,
  PickupChartJobInput,
  ReportAlertRaisedInput,
  ReportChartFetchInput,
  ReportOrderFilledInput,
  ReportRateLimit429Input,
  ReportSignalDetectedInput,
} from './be-control-plane.client';

export interface HttpBeControlPlaneClientOptions {
  readonly baseUrl: string;
  readonly signer: BeControlPlaneSigner;
  readonly timeoutMs?: number;
}

// HTTP-backed BeControlPlaneClient. Network failures throw BeNetworkError;
// protocol failures (401/429/4xx/5xx) are normalized into BeCallResult so
// the caller's policy stays explicit.
export class HttpBeControlPlaneClient implements BeControlPlaneClient {
  private readonly logger = new Logger(HttpBeControlPlaneClient.name);

  private readonly timeoutMs: number;

  constructor(private readonly opts: HttpBeControlPlaneClientOptions) {
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  pickupChartJob(input: PickupChartJobInput): Promise<BeCallResult<PickupResult>> {
    return this.post<PickupResult>('/control-plane/chart-jobs/pickup', input, (raw) => ({
      jobs: (raw as PickupJobResponseContract).jobs.map((j) => ({
        jobId: j.jobId,
        payload: j.payload,
      })),
    }));
  }

  reportChartFetch(input: ReportChartFetchInput): Promise<BeCallResult<void>> {
    return this.post<void>('/control-plane/chart-jobs/report', input);
  }

  fetchUniverseLease(input: FetchUniverseLeaseInput): Promise<BeCallResult<UniverseLeaseModel>> {
    return this.post<UniverseLeaseModel>(
      '/control-plane/universe/lease',
      input,
      (raw) => raw as UniverseLeaseModel,
    );
  }

  acquireChartBackfillLease(
    input: AcquireChartBackfillLeaseInput,
  ): Promise<BeCallResult<AcquireChartBackfillLeaseResult>> {
    return this.post<AcquireChartBackfillLeaseResult>(
      '/control-plane/chart-backfill/acquire',
      input,
      (raw) => raw as AcquireChartBackfillLeaseResult,
    );
  }

  reportChartBackfillOutcome(input: ChartBackfillOutcomePayload): Promise<BeCallResult<void>> {
    return this.post<void>('/control-plane/chart-backfill/report', input);
  }

  leaseCredential(input: LeaseCredentialInput): Promise<BeCallResult<CredentialLeaseModel>> {
    return this.post<CredentialLeaseModel>('/control-plane/credentials/lease', input, (raw) => {
      const r = raw as LeaseCredentialResponseContract;

      return {
        leaseId: r.leaseId,
        vendor: r.vendor,
        accountId: r.accountId,
        scope: r.scope,
        accessToken: r.accessToken,
        expiresAt: r.expiresAt,
        issuedAt: r.issuedAt,
      };
    });
  }

  acquireRateLimit(input: AcquireRateLimitInput): Promise<BeCallResult<AcquireRateLimitResult>> {
    return this.post<AcquireRateLimitResult>(
      '/control-plane/rate-limits/acquire',
      input,
      (raw) => raw as AcquireRateLimitResponseContract,
    );
  }

  reportRateLimit429(input: ReportRateLimit429Input): Promise<BeCallResult<void>> {
    return this.post<void>('/control-plane/rate-limits/observed-429', input);
  }

  reportSignalDetected(input: ReportSignalDetectedInput): Promise<BeCallResult<void>> {
    return this.post<void>('/control-plane/signals/detected', input);
  }

  reportOrderFilled(input: ReportOrderFilledInput): Promise<BeCallResult<void>> {
    return this.post<void>('/control-plane/orders/filled', input);
  }

  reportAlertRaised(input: ReportAlertRaisedInput): Promise<BeCallResult<void>> {
    return this.post<void>('/control-plane/alerts/raised', input);
  }

  private async post<T>(
    path: string,
    body: unknown,
    mapSuccess?: (raw: unknown) => T,
  ): Promise<BeCallResult<T>> {
    const signed = this.opts.signer.sign(body);
    const url = `${this.opts.baseUrl.replace(/\/$/, '')}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...signed.headers } as Record<string, string>,
        body: signed.body,
        signal: controller.signal,
      });

      return await this.classify(res, mapSuccess);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new BeNetworkError(`timeout after ${this.timeoutMs}ms`, { url });
      }

      throw new BeNetworkError(err instanceof Error ? err.message : String(err), { url });
    } finally {
      clearTimeout(timer);
    }
  }

  private async classify<T>(
    res: Response,
    mapSuccess?: (raw: unknown) => T,
  ): Promise<BeCallResult<T>> {
    const status = res.status;
    const text = await res.text().catch(() => '');
    const parsed = this.safeJson(text);

    if (status >= 200 && status < 300) {
      const data = mapSuccess ? mapSuccess(parsed) : (undefined as unknown as T);

      return { kind: 'success', data };
    }

    if (status === 401 || status === 403) {
      return {
        kind: 'denied',
        reason: extractReason(parsed) ?? res.statusText,
        httpStatus: status,
      };
    }

    if (status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined;

      return {
        kind: 'rate_limited',
        retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
        httpStatus: status,
      };
    }

    if (status >= 400 && status < 500) {
      return {
        kind: 'invalid',
        reason: extractReason(parsed) ?? res.statusText,
        httpStatus: status,
        details: parsed,
      };
    }

    return {
      kind: 'server_error',
      httpStatus: status,
      reason: extractReason(parsed) ?? res.statusText,
    };
  }

  private safeJson(text: string): unknown {
    if (!text) return undefined;

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

function extractReason(parsed: unknown): string | undefined {
  if (parsed && typeof parsed === 'object' && 'message' in parsed) {
    const m = (parsed as { message?: unknown }).message;

    if (typeof m === 'string') return m;
  }

  return undefined;
}
