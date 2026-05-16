export interface ReportSignalDetectedRequestContract {
  readonly signalId: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly strategy: string;
  readonly detectedAt: string;
  readonly payload: Record<string, unknown>;
}
