import { Injectable, Logger } from '@nestjs/common';
import type { OrderFilledPayload } from '@shared/event/order-filled.event';
import { ExecutionService } from '@roles/tracker/service/execution.service';

// Tracker-side execution-stream funnel. Delegates DB + bus side-effects to
// ExecutionService and keeps observability concerns (counters) here.
// Phase F: BE audit hook removed — the bus order.filled event flows to
// the notifier which records the audit row in `events`.
@Injectable()
export class IngestExecutionUsecase {
  private readonly logger = new Logger(IngestExecutionUsecase.name);

  private _fillCount = 0;

  private _terminalFillAnomalyCount = 0;

  private _unmatchedRetryAttempts = 0;

  private _unmatchedResolvedCount = 0;

  private _unmatchedDeadLetterCount = 0;

  private _pendingUnmatchedCount = 0;

  private _deadLetterFillCount = 0;

  private _pendingOutboxCount = 0;

  private _outboxPermanentFailureCount = 0;

  private _outboxPublishAttempts = 0;

  private _outboxPublishFailures = 0;

  private _lastFillAt: Date | null = null;

  private _lastTerminalFillAnomalyAt: Date | null = null;

  constructor(private readonly execution: ExecutionService) {}

  fillCount(): number {
    return this._fillCount;
  }

  terminalFillAnomalyCount(): number {
    return this._terminalFillAnomalyCount;
  }

  lastFillAt(): Date | null {
    return this._lastFillAt;
  }

  lastTerminalFillAnomalyAt(): Date | null {
    return this._lastTerminalFillAnomalyAt;
  }

  unmatchedRetryAttempts(): number {
    return this._unmatchedRetryAttempts;
  }

  unmatchedResolvedCount(): number {
    return this._unmatchedResolvedCount;
  }

  unmatchedDeadLetterCount(): number {
    return this._unmatchedDeadLetterCount;
  }

  pendingUnmatchedCount(): number {
    return this._pendingUnmatchedCount;
  }

  deadLetterFillCount(): number {
    return this._deadLetterFillCount;
  }

  pendingOutboxCount(): number {
    return this._pendingOutboxCount;
  }

  outboxPermanentFailureCount(): number {
    return this._outboxPermanentFailureCount;
  }

  outboxPublishAttempts(): number {
    return this._outboxPublishAttempts;
  }

  outboxPublishFailures(): number {
    return this._outboxPublishFailures;
  }

  async execute(payload: OrderFilledPayload): Promise<void> {
    const outcome = await this.execution.ingestFill(payload);

    if (outcome.anomaly?.startsWith('terminal-fill:')) {
      this._terminalFillAnomalyCount += 1;
      this._lastTerminalFillAnomalyAt = new Date();
    }

    if (!outcome.inserted) return;

    this._fillCount += 1;

    this._lastFillAt = new Date();
  }

  async retryUnmatched(limit: number): Promise<void> {
    const outcome = await this.execution.retryUnmatchedFills(limit);

    this._unmatchedRetryAttempts += outcome.attempted;
    this._unmatchedResolvedCount += outcome.resolved;
    this._unmatchedDeadLetterCount += outcome.deadLettered;
    await this.refreshBacklogCounts();
  }

  async flushOutbox(limit: number): Promise<void> {
    const outcome = await this.execution.flushFillOutbox(limit);

    this._outboxPublishAttempts += outcome.attempted;
    this._outboxPublishFailures += outcome.failed;
    await this.refreshBacklogCounts();
  }

  async refreshBacklogCounts(): Promise<void> {
    const [pendingUnmatched, deadLetterFills, pendingOutbox, outboxPermanentFailures] =
      await Promise.all([
        this.execution.countUnmatchedFills('PENDING'),
        this.execution.countUnmatchedFills('DEAD_LETTER'),
        this.execution.pendingOutboxCount(),
        this.execution.outboxPermanentFailureCount(),
      ]);

    this._pendingUnmatchedCount = pendingUnmatched;
    this._deadLetterFillCount = deadLetterFills;
    this._pendingOutboxCount = pendingOutbox;
    this._outboxPermanentFailureCount = outboxPermanentFailures;
  }
}
