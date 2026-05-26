import { Injectable } from '@nestjs/common';
import { RedisSubscriberBase, type ChannelBinding } from '@shared/bus/trigger/redis-subscriber.base';
import { RedisBusSubscriber } from '@shared/bus/redis/redis-bus-subscriber';
import {
  ORDER_COMMAND_CHANNEL,
  ORDER_COMMAND_EVENT_TYPE,
  ORDER_COMMAND_SCHEMA_VERSION,
  type OrderCommandPayload,
} from '@shared/event/order-command.event';
import type { WorkerEvent } from '@shared/event/worker-event';
import { PickupRequestedOrdersUsecase } from '@roles/executor/usecase/pickup-requested-orders.usecase';

@Injectable()
export class OrderCommandSubscriber extends RedisSubscriberBase {
  constructor(
    subscriber: RedisBusSubscriber,
    private readonly pickupRequested: PickupRequestedOrdersUsecase,
  ) {
    super(subscriber);
  }

  protected bindings(): ReadonlyArray<ChannelBinding> {
    return [
      {
        channel: ORDER_COMMAND_CHANNEL,
        handle: (event) => this.handleOrderCommand(event as WorkerEvent<OrderCommandPayload>),
      },
    ];
  }

  private async handleOrderCommand(event: WorkerEvent<OrderCommandPayload>): Promise<void> {
    if (
      event.eventType !== ORDER_COMMAND_EVENT_TYPE ||
      event.schemaVersion !== ORDER_COMMAND_SCHEMA_VERSION
    ) {
      this.logger.warn(
        `order command dropped: unexpected event=${event.eventType} schema=${event.schemaVersion}`,
      );

      return;
    }

    const orderId = Number(event.payload?.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      this.logger.warn(`order command dropped: invalid orderId=${String(event.payload?.orderId)}`);

      return;
    }

    const processed = await this.pickupRequested.executeOrderId(orderId);
    if (!processed) {
      this.logger.warn(`order command ignored: orderId=${orderId} not claimable`);
    }
  }
}
