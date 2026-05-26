import { Inject, Injectable, Logger } from '@nestjs/common';
import { ORDER_REPOSITORY } from '@shared/persistence/order/order.token';
import type { OrderRepository } from '@shared/persistence/order/order.repository';
import { OrderStatus } from '@shared/model/order/order-status.enum';

const DEFAULT_STALE_MS = readPositiveInt(
  process.env.TRACKER_STUCK_ORDER_THRESHOLD_MS,
  5 * 60_000,
);
const DEFAULT_LIMIT = readPositiveInt(process.env.TRACKER_STUCK_ORDER_SCAN_LIMIT, 50);
const ACCEPTED_STALE_MS = readPositiveInt(
  process.env.TRACKER_ACCEPTED_STALE_INFO_THRESHOLD_MS,
  24 * 60 * 60_000,
);

@Injectable()
export class MonitorStuckOrdersUsecase {
  private readonly logger = new Logger(MonitorStuckOrdersUsecase.name);

  private _lastScanAt: Date | null = null;

  private _lastStuckCount = 0;

  private _lastAcceptedStaleCount = 0;

  constructor(@Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository) {}

  lastScanAt(): Date | null {
    return this._lastScanAt;
  }

  lastStuckCount(): number {
    return this._lastStuckCount;
  }

  lastAcceptedStaleCount(): number {
    return this._lastAcceptedStaleCount;
  }

  async execute(): Promise<number> {
    const olderThan = new Date(Date.now() - DEFAULT_STALE_MS);
    const stale = await this.orders.findStaleOrders(
      [
        OrderStatus.Submitting,
        OrderStatus.CancelRequested,
        OrderStatus.CancelSubmitting,
      ],
      olderThan,
      DEFAULT_LIMIT,
    );

    this._lastScanAt = new Date();
    this._lastStuckCount = stale.length;
    const acceptedStale = await this.orders.findStaleOrders(
      [OrderStatus.Accepted],
      new Date(Date.now() - ACCEPTED_STALE_MS),
      DEFAULT_LIMIT,
    );
    this._lastAcceptedStaleCount = acceptedStale.length;

    for (const order of stale) {
      this.logger.warn(
        `stuck-order dry-run orderId=${order.id} accountId=${order.accountId} status=${order.status} updatedAt=${order.updatedAt.toISOString()} brokerOrderId=${order.brokerOrderId ?? 'null'} externalOrderId=${order.externalOrderId ?? 'null'}`,
      );
    }

    if (acceptedStale.length > 0) {
      this.logger.log(`accepted-stale info count=${acceptedStale.length}`);
    }

    return stale.length;
  }
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
