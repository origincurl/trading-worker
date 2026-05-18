import { Injectable } from '@nestjs/common';
import type { RoleStatus, RoleStatusProvider } from '@roles/role-status';

@Injectable()
export class NotifierStatusService implements RoleStatusProvider {
  private readonly bootedAt = Date.now();

  private _ingested = 0;

  private _outboxRowsCreated = 0;

  private _dispatched = 0;

  private _dispatchFailures = 0;

  private _lastIngestedAt: Date | null = null;

  private _lastDispatchAt: Date | null = null;

  // Counters maintained in-memory only. Heartbeat usecase emits the same
  // snapshot via HeartbeatWriter for redis visibility, while /health pulls
  // it via getStatus(). Reset on process restart, same as other roles.

  recordIngest(): void {
    this._ingested += 1;
    this._lastIngestedAt = new Date();
  }

  recordOutboxRows(count: number): void {
    this._outboxRowsCreated += count;
  }

  recordDispatch(result: 'ok' | 'failed'): void {
    if (result === 'ok') this._dispatched += 1;
    else this._dispatchFailures += 1;

    this._lastDispatchAt = new Date();
  }

  ingestedCount(): number {
    return this._ingested;
  }

  outboxRowsCreated(): number {
    return this._outboxRowsCreated;
  }

  dispatchedCount(): number {
    return this._dispatched;
  }

  dispatchFailureCount(): number {
    return this._dispatchFailures;
  }

  lastIngestedAt(): Date | null {
    return this._lastIngestedAt;
  }

  lastDispatchAt(): Date | null {
    return this._lastDispatchAt;
  }

  getStatus(): RoleStatus {
    return {
      role: 'notifier',
      ready: true,
      detail:
        `ingested=${this._ingested} ` +
        `outboxRows=${this._outboxRowsCreated} ` +
        `dispatched=${this._dispatched} ` +
        `dispatchFailures=${this._dispatchFailures} ` +
        `lastIngestedAt=${this._lastIngestedAt?.toISOString() ?? 'never'} ` +
        `lastDispatchAt=${this._lastDispatchAt?.toISOString() ?? 'never'} ` +
        `uptime=${Math.floor((Date.now() - this.bootedAt) / 1000)}s`,
    };
  }
}
