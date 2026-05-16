export interface ReportRateLimit429RequestContract {
  readonly endpoint: string;
  readonly observedAt: string;
  readonly retryAfterMs?: number;
}
