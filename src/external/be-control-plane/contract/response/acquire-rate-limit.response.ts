export interface AcquireRateLimitResponseContract {
  readonly granted: boolean;
  readonly tokens: number;
  readonly resetAtMs?: number;
}
