// Backfill job assigned to a worker by BE control-plane. The lease has a
// lifetime — BE re-issues if the worker fails to report by `expiresAt`.

export type CandleInterval = '1m' | '1d';

export interface ChartBackfillLeaseModel {
  readonly leaseId: string;
  readonly marketEnv: 'mock' | 'production';
  readonly symbol: string;
  readonly intervalType: CandleInterval;
  readonly fromIso: string;
  readonly toIso: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface ChartBackfillOutcomePayload {
  readonly leaseId: string;
  readonly workerInstanceId: string;
  readonly symbol: string;
  readonly intervalType: CandleInterval;
  readonly fromIso: string;
  readonly toIso: string;
  readonly candlesWritten: number;
  readonly candlesSkipped: number;
  readonly errors: ReadonlyArray<{ code: string; detail: string }>;
  readonly startedAt: string;
  readonly completedAt: string;
}
