import { Logger } from '@nestjs/common';
import { RateLimitExceededError } from '@common/error/domain.error';

export interface RateLimiterOptions {
  readonly name: string;
  // Token bucket: bucket holds up to `capacity` tokens, refilled at `refillPerSecond`/s.
  readonly capacity: number;
  readonly refillPerSecond: number;
  // Concurrent in-flight cap. 0 = unlimited.
  readonly maxConcurrent?: number;
  // If true, acquire() waits up to maxWaitMs for capacity; otherwise throws immediately.
  readonly waitOnExhaustion?: boolean;
  readonly maxWaitMs?: number;
}

// Process-local rate limiter. One instance per (vendor, profile) — collector
// and executor MUST receive distinct instances so their budgets never mix.
// The BE control-plane rate-limit acquire (Phase 4) layers on top of this.
export class RateLimiter {
  private readonly logger: Logger;

  private tokens: number;

  private lastRefillMs: number;

  private inFlight = 0;

  constructor(private readonly opts: RateLimiterOptions) {
    if (opts.capacity <= 0) {
      throw new Error('RateLimiter: capacity must be > 0');
    }

    if (opts.refillPerSecond <= 0) {
      throw new Error('RateLimiter: refillPerSecond must be > 0');
    }

    this.tokens = opts.capacity;

    this.lastRefillMs = Date.now();

    this.logger = new Logger(`RateLimiter[${opts.name}]`);
  }

  async acquire(): Promise<void> {
    const maxConcurrent = this.opts.maxConcurrent ?? 0;

    if (maxConcurrent > 0 && this.inFlight >= maxConcurrent) {
      throw new RateLimitExceededError(
        `concurrency cap reached for ${this.opts.name} (${this.inFlight}/${maxConcurrent})`,
        { limiter: this.opts.name, kind: 'concurrent' },
      );
    }

    if (!this.tryTake()) {
      if (!this.opts.waitOnExhaustion) {
        throw new RateLimitExceededError(`token bucket empty for ${this.opts.name}`, {
          limiter: this.opts.name,
          kind: 'tokens',
        });
      }

      await this.waitForToken();
    }

    this.inFlight++;
  }

  release(): void {
    if (this.inFlight > 0) this.inFlight--;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();

    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private tryTake(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;

      return true;
    }

    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefillMs) / 1000;
    const add = elapsedSec * this.opts.refillPerSecond;

    if (add > 0) {
      this.tokens = Math.min(this.opts.capacity, this.tokens + add);

      this.lastRefillMs = now;
    }
  }

  private async waitForToken(): Promise<void> {
    const deadline = Date.now() + (this.opts.maxWaitMs ?? 1000);
    const pollMs = Math.max(10, Math.floor(1000 / this.opts.refillPerSecond));

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));

      if (this.tryTake()) return;
    }

    throw new RateLimitExceededError(`timed out waiting for token in ${this.opts.name}`, {
      limiter: this.opts.name,
      kind: 'timeout',
    });
  }
}
