import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BROKER_STATUS_GATEWAY,
  type BrokerStatusGateway,
} from '@roles/tracker/service/broker-status.gateway';
import { OrderStatus } from '@shared/model/order/order-status.enum';
import type { OrderRepository } from '@shared/persistence/order/order.repository';
import { ORDER_REPOSITORY } from '@shared/persistence/order/order.token';

const DEFAULT_THRESHOLD_MS = readPositiveInt(
  process.env.TRACKER_BROKER_RECONCILIATION_THRESHOLD_MS,
  5 * 60_000,
);
const DEFAULT_LIMIT = readPositiveInt(process.env.TRACKER_BROKER_RECONCILIATION_LIMIT, 50);

@Injectable()
export class BrokerReconciliationUsecase {
  private readonly logger = new Logger(BrokerReconciliationUsecase.name);

  private _lastScanAt: Date | null = null;

  private _lastDryRunCount = 0;

  private _lastKillSwitchCancelCount = 0;

  private _lastBrokerStatusMissingCount = 0;

  private _lastBrokerStatusDiffCount = 0;

  private _lastBrokerQuantityDiffCount = 0;

  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(BROKER_STATUS_GATEWAY) private readonly brokerStatus: BrokerStatusGateway,
  ) {}

  lastScanAt(): Date | null {
    return this._lastScanAt;
  }

  lastDryRunCount(): number {
    return this._lastDryRunCount;
  }

  lastKillSwitchCancelCount(): number {
    return this._lastKillSwitchCancelCount;
  }

  lastBrokerStatusMissingCount(): number {
    return this._lastBrokerStatusMissingCount;
  }

  lastBrokerStatusDiffCount(): number {
    return this._lastBrokerStatusDiffCount;
  }

  lastBrokerQuantityDiffCount(): number {
    return this._lastBrokerQuantityDiffCount;
  }

  async execute(): Promise<void> {
    const stale = await this.orders.findStaleOrders(
      [OrderStatus.Submitting, OrderStatus.CancelRequested, OrderStatus.CancelSubmitting],
      new Date(Date.now() - DEFAULT_THRESHOLD_MS),
      DEFAULT_LIMIT,
    );

    this._lastScanAt = new Date();
    this._lastDryRunCount = stale.length;
    this._lastKillSwitchCancelCount = stale.filter(
      (order) =>
        order.status === OrderStatus.CancelRequested ||
        order.status === OrderStatus.CancelSubmitting,
    ).length;
    this._lastBrokerStatusMissingCount = 0;
    this._lastBrokerStatusDiffCount = 0;
    this._lastBrokerQuantityDiffCount = 0;

    for (const order of stale) {
      this.logger.warn(
        `broker-reconciliation dry-run orderId=${order.id} accountId=${order.accountId} status=${order.status} brokerOrderId=${order.brokerOrderId ?? 'null'} externalOrderId=${order.externalOrderId ?? 'null'}`,
      );
      if (order.accountExternalId && (order.brokerOrderId || order.externalOrderId)) {
        const broker = await this.brokerStatus.getOrderStatus(
          order.accountId,
          order.accountExternalId,
          order.brokerOrderId ?? order.externalOrderId ?? '',
        );
        if (!broker) {
          this._lastBrokerStatusMissingCount += 1;
          this.logger.warn(`broker-reconciliation missing-broker-status orderId=${order.id}`);
          continue;
        }

        const statusDiff = !brokerStatusMatches(order.status, broker.status);
        const quantityDiff =
          broker.filledQty !== null &&
          normalizeDecimal(order.filledQuantity) !== normalizeDecimal(broker.filledQty);

        if (statusDiff) this._lastBrokerStatusDiffCount += 1;
        if (quantityDiff) this._lastBrokerQuantityDiffCount += 1;
        if (statusDiff || quantityDiff) {
          this.logger.warn(
            `broker-reconciliation diff orderId=${order.id} dbStatus=${order.status} brokerStatus=${broker.status} dbFilledQty=${order.filledQuantity} brokerFilledQty=${broker.filledQty ?? 'null'} brokerRemainingQty=${broker.remainingQty ?? 'null'}`,
          );
        }
      }
    }
  }
}

function brokerStatusMatches(dbStatus: OrderStatus, brokerStatus: string): boolean {
  const normalized = brokerStatus.trim().toUpperCase();

  if (normalized.includes('CANCEL')) {
    return dbStatus === OrderStatus.Cancelled || dbStatus === OrderStatus.CancelSubmitting;
  }
  if (normalized.includes('FILL') || normalized.includes('체결')) {
    return dbStatus === OrderStatus.Filled || dbStatus === OrderStatus.PartiallyFilled;
  }
  if (normalized.includes('REJECT') || normalized.includes('거부')) {
    return dbStatus === OrderStatus.Rejected || dbStatus === OrderStatus.Failed;
  }
  if (normalized.includes('ACCEPT') || normalized.includes('접수')) {
    return dbStatus === OrderStatus.Accepted || dbStatus === OrderStatus.Submitting;
  }

  return true;
}

function normalizeDecimal(value: string | null | undefined): string {
  if (!value) return '0';
  if (!value.includes('.')) return value.replace(/^0+(?=\d)/, '') || '0';
  const [whole, fraction] = value.split('.');
  const trimmedFraction = (fraction ?? '').replace(/0+$/, '');

  return `${whole.replace(/^0+(?=\d)/, '') || '0'}${trimmedFraction ? `.${trimmedFraction}` : ''}`;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
