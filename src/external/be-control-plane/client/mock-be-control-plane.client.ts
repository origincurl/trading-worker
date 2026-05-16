import { Logger } from '@nestjs/common';
import { newEventId } from '@shared/event/event-id';
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
import type { AcquireRateLimitResult, BeCallResult, PickupResult } from '../model/be-result.model';
import type { ChartBackfillOutcomePayload } from '../model/chart-backfill-lease.model';
import type { CredentialLeaseModel } from '../model/credential-lease.model';
import type { UniverseLeaseModel } from '../model/universe-lease.model';

// In-memory BE control-plane impl. Active when BE_CONTROL_PLANE_MOCK=true
// (typically dev). Returns sane defaults so role code can be developed
// against the real interface without an actual BE running.
export class MockBeControlPlaneClient implements BeControlPlaneClient {
  private readonly logger = new Logger(MockBeControlPlaneClient.name);

  async pickupChartJob(input: PickupChartJobInput): Promise<BeCallResult<PickupResult>> {
    void input;

    return { kind: 'success', data: { jobs: [] } };
  }

  async reportChartFetch(input: ReportChartFetchInput): Promise<BeCallResult<void>> {
    this.logger.debug(`[mock] chart fetch reported: ${input.jobId} status=${input.status}`);

    return { kind: 'success', data: undefined };
  }

  async fetchUniverseLease(
    input: FetchUniverseLeaseInput,
  ): Promise<BeCallResult<UniverseLeaseModel>> {
    const now = new Date();

    const lease: UniverseLeaseModel = {
      leaseId: newEventId(),
      marketEnv: input.marketEnv,
      version: 1,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      symbols: [
        { symbol: '005930', market: 'KOSPI' },
        { symbol: '000660', market: 'KOSPI' },
      ],
    };

    return { kind: 'success', data: lease };
  }

  async acquireChartBackfillLease(
    input: AcquireChartBackfillLeaseInput,
  ): Promise<BeCallResult<AcquireChartBackfillLeaseResult>> {
    void input;

    return { kind: 'success', data: { leases: [] } };
  }

  async reportChartBackfillOutcome(
    input: ChartBackfillOutcomePayload,
  ): Promise<BeCallResult<void>> {
    this.logger.debug(
      `[mock] chart backfill outcome: lease=${input.leaseId} written=${input.candlesWritten} skipped=${input.candlesSkipped}`,
    );

    return { kind: 'success', data: undefined };
  }

  async leaseCredential(input: LeaseCredentialInput): Promise<BeCallResult<CredentialLeaseModel>> {
    const now = new Date();
    const expires = new Date(now.getTime() + 60 * 60 * 1000);

    const lease: CredentialLeaseModel = {
      leaseId: newEventId(),
      vendor: input.vendor,
      accountId: input.accountId,
      scope: input.scope,
      accessToken: `mock-token-${newEventId()}`,
      expiresAt: expires.toISOString(),
      issuedAt: now.toISOString(),
    };

    return { kind: 'success', data: lease };
  }

  async acquireRateLimit(
    input: AcquireRateLimitInput,
  ): Promise<BeCallResult<AcquireRateLimitResult>> {
    return {
      kind: 'success',
      data: { granted: true, tokens: input.tokens, resetAtMs: Date.now() + 1000 },
    };
  }

  async reportRateLimit429(input: ReportRateLimit429Input): Promise<BeCallResult<void>> {
    this.logger.warn(`[mock] 429 observed on ${input.endpoint}`);

    return { kind: 'success', data: undefined };
  }

  async reportSignalDetected(input: ReportSignalDetectedInput): Promise<BeCallResult<void>> {
    this.logger.debug(`[mock] signal reported: ${input.signalId}`);

    return { kind: 'success', data: undefined };
  }

  async reportOrderFilled(input: ReportOrderFilledInput): Promise<BeCallResult<void>> {
    this.logger.debug(`[mock] order filled: ${input.vendorOrderId}`);

    return { kind: 'success', data: undefined };
  }

  async reportAlertRaised(input: ReportAlertRaisedInput): Promise<BeCallResult<void>> {
    this.logger.debug(`[mock] alert raised: ${input.alertId} (${input.severity})`);

    return { kind: 'success', data: undefined };
  }
}
