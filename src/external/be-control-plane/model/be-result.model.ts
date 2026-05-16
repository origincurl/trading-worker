// Typed result union for BE control-plane calls. Callers MUST switch on
// `kind` — we deliberately avoid throwing on protocol-level failures
// (401/429/5xx) so retry / circuit-breaker policy stays explicit at the
// call site. Network-level failures still throw IntegrationError.

export type BeCallResult<T> =
  | { kind: 'success'; data: T }
  | { kind: 'denied'; reason: string; httpStatus: number }
  | { kind: 'invalid'; reason: string; httpStatus: number; details?: unknown }
  | { kind: 'rate_limited'; retryAfterMs?: number; httpStatus: number }
  | { kind: 'server_error'; httpStatus: number; reason: string };

export interface PickupResult {
  readonly jobs: ReadonlyArray<{ readonly jobId: string; readonly payload: unknown }>;
}

export interface AcquireRateLimitResult {
  readonly granted: boolean;
  readonly tokens: number;
  readonly resetAtMs?: number;
}
