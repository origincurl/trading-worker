import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError } from '@common/error/domain.error';
import { EXECUTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type { BrokerageVendor } from '@external/brokerage/vendor/brokerage.vendor';
import { ORDER_REPOSITORY } from '@shared/persistence/order/order.token';
import type { OrderRepository } from '@shared/persistence/order/order.repository';
import { BUS_STREAMS } from '@shared/bus/bus.token';
import type { BusStreams } from '@shared/bus/bus-streams.interface';
import { WorkerEventFactory } from '@shared/event/event-factory';
import {
  ORDER_FAILED_EVENT_TYPE,
  ORDER_FAILED_SCHEMA_VERSION,
  ORDER_FAILED_STREAM,
  type OrderFailedPayload,
} from '@shared/event/order-failed.event';
import {
  ORDER_PLACED_EVENT_TYPE,
  ORDER_PLACED_SCHEMA_VERSION,
  ORDER_PLACED_STREAM,
  type OrderPlacedPayload,
} from '@shared/event/order-placed.event';
import { OrderMethod } from '@shared/model/order/order-method.enum';
import { OrderStatus } from '@shared/model/order/order-status.enum';
import { OrderType } from '@shared/model/order/order-type.enum';
import type { OrderModel } from '@shared/model/order/order.model';

const DEFAULT_BATCH_SIZE = 20;

// Phase J: drains REQUESTED orders the BE has written into the shared
// `orders` table. The repository atomically claims rows by flipping
// REQUESTED -> SUBMITTING before returning them. For every claimed row we
// resolve the account-scoped vendor credential, fire
// EXECUTOR_BROKERAGE_VENDOR.placeOrderForAccount, and translate the
// outcome into the ACCEPTED / REJECTED / FAILED terminal status update.
// All status writes use the SKIP LOCKED pickup so concurrent worker pods
// won't double-place the same row.
@Injectable()
export class PickupRequestedOrdersUsecase {
  private readonly logger = new Logger(PickupRequestedOrdersUsecase.name);

  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(EXECUTOR_BROKERAGE_VENDOR) private readonly gateway: BrokerageVendor,
    @Inject(BUS_STREAMS) private readonly streams: BusStreams,
    private readonly eventFactory: WorkerEventFactory,
  ) {}

  async execute(batchSize: number = DEFAULT_BATCH_SIZE): Promise<number> {
    const batch = await this.orders.findRequestedBatch(batchSize);

    if (batch.length === 0) return 0;

    let processed = 0;

    for (const order of batch) {
      try {
        await this.processOne(order);
        processed += 1;
      } catch (err) {
        this.logger.warn(
          `pickup-requested order id=${order.id} threw: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return processed;
  }

  private async processOne(order: OrderModel): Promise<void> {
    const placeInput = this.toPlaceInput(order);

    try {
      const ack = await this.gateway.placeOrderForAccount(
        Number(order.accountId),
        placeInput,
      );

      await this.orders.updateStatus(order.id, {
        status: OrderStatus.Accepted,
        brokerOrderId: ack.vendorOrderId,
        externalOrderId: ack.vendorOrderId,
        acceptedAt: new Date(),
      });

      await this.publishPlaced(order, ack.vendorOrderId);
    } catch (err) {
      const code = err instanceof DomainError ? err.code : 'PLACE_ORDER_FAILED';
      const message = err instanceof Error ? err.message : String(err);
      // Vendor refused → REJECTED (terminal but vendor-side).
      // System / infra error → FAILED (terminal but our side).
      const isRejection = code === 'VENDOR_REJECTED';
      const nextStatus = isRejection ? OrderStatus.Rejected : OrderStatus.Failed;

      await this.orders.updateStatus(order.id, {
        status: nextStatus,
        failedAt: new Date(),
        failureReason: message.slice(0, 1000),
      });

      this.logger.warn(
        `pickup-requested order id=${order.id} ${nextStatus}: code=${code} msg=${message}`,
      );

      await this.publishFailed(order, code, message);
    }
  }

  private toPlaceInput(order: OrderModel): Parameters<
    BrokerageVendor['placeOrderForAccount']
  >[1] {
    const side = order.orderType === OrderType.Buy ? 'buy' : 'sell';
    const type = order.orderMethod === OrderMethod.Limit ? 'limit' : 'market';
    const quantity = Number(order.quantity);
    const price = order.price !== null ? Number(order.price) : undefined;

    return {
      accountId: order.accountExternalId ?? String(order.accountId),
      clientOrderId: order.clientOrderId ?? `order-${order.id}`,
      symbol: order.rawRequest?.symbol as string | undefined ?? '',
      side,
      type,
      quantity,
      price,
    };
  }

  private async publishPlaced(order: OrderModel, vendorOrderId: string): Promise<void> {
    const symbol = (order.rawRequest?.symbol as string | undefined) ?? '';
    const payload: OrderPlacedPayload = {
      accountExternalId: order.accountExternalId ?? String(order.accountId),
      brokerage: 'kiwoom',
      marketEnv: order.marketEnv === 'PRODUCTION' ? 'production' : 'mock',
      externalOrderId: vendorOrderId,
      clientOrderId: order.clientOrderId,
      symbol,
      orderType: order.orderType === OrderType.Buy ? 'BUY' : 'SELL',
      orderMethod: order.orderMethod === OrderMethod.Limit ? 'LIMIT' : 'MARKET',
      quantity: order.quantity,
      price: order.price,
      placedAt: new Date().toISOString(),
    };

    const event = this.eventFactory.build({
      eventType: ORDER_PLACED_EVENT_TYPE,
      schemaVersion: ORDER_PLACED_SCHEMA_VERSION,
      role: 'executor',
      payload,
    });

    await this.streams.produce(ORDER_PLACED_STREAM, event).catch((err) =>
      this.logger.warn(
        `order.placed produce failed orderId=${order.id}: ${err instanceof Error ? err.message : err}`,
      ),
    );
  }

  private async publishFailed(
    order: OrderModel,
    errorCode: string,
    reason: string,
  ): Promise<void> {
    const symbol = (order.rawRequest?.symbol as string | undefined) ?? '';
    const payload: OrderFailedPayload = {
      accountExternalId: order.accountExternalId ?? String(order.accountId),
      brokerage: 'kiwoom',
      marketEnv: order.marketEnv === 'PRODUCTION' ? 'production' : 'mock',
      clientOrderId: order.clientOrderId,
      symbol,
      reason,
      errorCode,
      failedAt: new Date().toISOString(),
    };

    const event = this.eventFactory.build({
      eventType: ORDER_FAILED_EVENT_TYPE,
      schemaVersion: ORDER_FAILED_SCHEMA_VERSION,
      role: 'executor',
      payload,
    });

    await this.streams.produce(ORDER_FAILED_STREAM, event).catch((err) =>
      this.logger.warn(
        `order.failed produce failed orderId=${order.id}: ${err instanceof Error ? err.message : err}`,
      ),
    );
  }
}
