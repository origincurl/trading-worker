import type { AcquireRateLimitResult, BeCallResult, PickupResult } from '../model/be-result.model';
import type {
  ChartBackfillLeaseModel,
  ChartBackfillOutcomePayload,
} from '../model/chart-backfill-lease.model';
import type { CredentialLeaseModel } from '../model/credential-lease.model';
import type { UniverseLeaseModel } from '../model/universe-lease.model';

export interface PickupChartJobInput {
  readonly jobType: string;
  readonly maxJobs: number;
}

export interface ReportChartFetchInput {
  readonly jobId: string;
  readonly status: 'ok' | 'failed';
  readonly rowsFetched: number;
  readonly errorMessage?: string;
}

export interface LeaseCredentialInput {
  readonly vendor: string;
  readonly accountId: string;
  readonly scope: string;
}

export interface FetchUniverseLeaseInput {
  readonly marketEnv: 'mock' | 'production';
  readonly knownVersion?: number;
}

export interface AcquireRateLimitInput {
  readonly endpoint: string;
  readonly tokens: number;
}

export interface ReportRateLimit429Input {
  readonly endpoint: string;
  readonly observedAt: string;
  readonly retryAfterMs?: number;
}

export interface ReportSignalDetectedInput {
  readonly signalId: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly strategy: string;
  readonly detectedAt: string;
  readonly payload: Record<string, unknown>;
}

export interface ReportOrderFilledInput {
  readonly vendorOrderId: string;
  readonly clientOrderId: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly filledQty: number;
  readonly filledPrice: number;
  readonly filledAt: string;
}

export interface ReportAlertRaisedInput {
  readonly alertId: string;
  readonly category: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly subject: string;
  readonly message: string;
  readonly raisedAt: string;
  readonly metadata?: Record<string, string>;
}

export interface AcquireChartBackfillLeaseInput {
  readonly marketEnv: 'mock' | 'production';
  readonly maxLeases: number;
}

export interface AcquireChartBackfillLeaseResult {
  readonly leases: readonly ChartBackfillLeaseModel[];
}

export interface BeControlPlaneClient {
  pickupChartJob(input: PickupChartJobInput): Promise<BeCallResult<PickupResult>>;
  reportChartFetch(input: ReportChartFetchInput): Promise<BeCallResult<void>>;

  leaseCredential(input: LeaseCredentialInput): Promise<BeCallResult<CredentialLeaseModel>>;

  fetchUniverseLease(input: FetchUniverseLeaseInput): Promise<BeCallResult<UniverseLeaseModel>>;

  acquireChartBackfillLease(
    input: AcquireChartBackfillLeaseInput,
  ): Promise<BeCallResult<AcquireChartBackfillLeaseResult>>;

  reportChartBackfillOutcome(input: ChartBackfillOutcomePayload): Promise<BeCallResult<void>>;

  acquireRateLimit(input: AcquireRateLimitInput): Promise<BeCallResult<AcquireRateLimitResult>>;
  reportRateLimit429(input: ReportRateLimit429Input): Promise<BeCallResult<void>>;

  reportSignalDetected(input: ReportSignalDetectedInput): Promise<BeCallResult<void>>;
  reportOrderFilled(input: ReportOrderFilledInput): Promise<BeCallResult<void>>;
  reportAlertRaised(input: ReportAlertRaisedInput): Promise<BeCallResult<void>>;
}

export const BE_CONTROL_PLANE_CLIENT = Symbol('BE_CONTROL_PLANE_CLIENT');
