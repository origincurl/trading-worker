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

  private _lastFillAt: Date | null = null;

  constructor(private readonly execution: ExecutionService) {}

  fillCount(): number {
    return this._fillCount;
  }

  lastFillAt(): Date | null {
    return this._lastFillAt;
  }

  async execute(payload: OrderFilledPayload): Promise<void> {
    const outcome = await this.execution.ingestFill(payload);

    if (!outcome.inserted) return;

    this._fillCount += 1;

    this._lastFillAt = new Date();
  }
}
