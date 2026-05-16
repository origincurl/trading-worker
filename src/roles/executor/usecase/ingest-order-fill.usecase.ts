import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BE_CONTROL_PLANE_CLIENT,
  type BeControlPlaneClient,
} from '@external/be-control-plane/client/be-control-plane.client';
import { BUS_STREAMS } from '@shared/bus/bus.token';
import type { BusStreams } from '@shared/bus/bus-streams.interface';
import { WorkerEventFactory } from '@shared/event/event-factory';
import {
  ORDER_FILLED_EVENT_TYPE,
  ORDER_FILLED_SCHEMA_VERSION,
  ORDER_FILLED_STREAM,
  type OrderFilledPayload,
} from '@shared/event/order-filled.event';
import {
  ORDER_REPOSITORY,
  type OrderRepository,
} from '@roles/executor/repository/order.repository';

// Funnel for execution-stream fills: DB upsert (vendorOrderId dedup) →
// Streams produce → BE audit hook. Each sink is best-effort independent
// of the others.
@Injectable()
export class IngestOrderFillUsecase {
  private readonly logger = new Logger(IngestOrderFillUsecase.name);

  private _fillCount = 0;

  private _lastFillAt: Date | null = null;

  constructor(
    @Inject(ORDER_REPOSITORY) private readonly repo: OrderRepository,
    @Inject(BUS_STREAMS) private readonly streams: BusStreams,
    @Inject(BE_CONTROL_PLANE_CLIENT) private readonly be: BeControlPlaneClient,
    private readonly eventFactory: WorkerEventFactory,
  ) {}

  fillCount(): number {
    return this._fillCount;
  }

  lastFillAt(): Date | null {
    return this._lastFillAt;
  }

  async execute(payload: OrderFilledPayload): Promise<void> {
    let outcome: 'inserted' | 'duplicate' = 'inserted';

    try {
      outcome = await this.repo.upsertFill(payload);
    } catch (err) {
      this.logger.warn(
        `order_fill upsert failed (${payload.vendorOrderId}): ${err instanceof Error ? err.message : err}`,
      );
    }

    if (outcome === 'duplicate') return;

    this._fillCount += 1;

    this._lastFillAt = new Date();

    const event = this.eventFactory.build({
      eventType: ORDER_FILLED_EVENT_TYPE,
      schemaVersion: ORDER_FILLED_SCHEMA_VERSION,
      role: 'executor',
      payload,
    });

    await Promise.all([
      this.streams
        .produce(ORDER_FILLED_STREAM, event)
        .catch((err) =>
          this.logger.warn(
            `order.filled stream produce failed (${payload.vendorOrderId}): ${err instanceof Error ? err.message : err}`,
          ),
        ),
      this.be
        .reportOrderFilled({
          vendorOrderId: payload.vendorOrderId,
          clientOrderId: payload.clientOrderId,
          accountId: payload.accountId,
          symbol: payload.symbol,
          filledQty: payload.filledQty,
          filledPrice: payload.filledPrice,
          filledAt: payload.filledAt,
        })
        .catch((err) =>
          this.logger.warn(
            `BE reportOrderFilled failed: ${err instanceof Error ? err.message : err}`,
          ),
        ),
    ]);
  }
}
