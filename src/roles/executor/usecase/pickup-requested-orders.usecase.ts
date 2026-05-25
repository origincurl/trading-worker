import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DomainError } from '@common/error/domain.error';
import { EXECUTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type { BrokerageVendor } from '@external/brokerage/vendor/brokerage.vendor';
import { REDIS_CLIENT, type RedisClientToken } from '@shared/cache/redis.module';
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
const ACCOUNT_LOCK_TTL_MS = readPositiveInt(
  process.env.EXECUTOR_ACCOUNT_LOCK_TTL_MS,
  60_000,
);
const ACCOUNT_LOCK_WAIT_MS = readPositiveInt(
  process.env.EXECUTOR_ACCOUNT_LOCK_WAIT_MS,
  30_000,
);
const ACCOUNT_LOCK_POLL_MS = readPositiveInt(
  process.env.EXECUTOR_ACCOUNT_LOCK_POLL_MS,
  50,
);
const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

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

  private readonly accountChains = new Map<number, Promise<void>>();

  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(EXECUTOR_BROKERAGE_VENDOR) private readonly gateway: BrokerageVendor,
    @Inject(BUS_STREAMS) private readonly streams: BusStreams,
    private readonly eventFactory: WorkerEventFactory,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: RedisClientToken,
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

  async executeOrderId(orderId: number): Promise<boolean> {
    const order = await this.orders.findAndClaimRequestedById(orderId);
    if (!order) return false;

    await this.processOne(order);

    return true;
  }

  private async processOne(order: OrderModel): Promise<void> {
    await this.withAccountOrderLock(Number(order.accountId), () =>
      this.withDistributedAccountLock(Number(order.accountId), () =>
        this.placeClaimedOrder(order),
      ).catch((err) => this.failClaimedOrder(order, err)),
    );
  }

  private async placeClaimedOrder(order: OrderModel): Promise<void> {
    const placeInput = this.toPlaceInput(order);

    try {
      const apiCredentialId = Number(order.apiCredentialId);
      if (!Number.isInteger(apiCredentialId) || apiCredentialId <= 0) {
        throw new DomainError(
          'manual order is missing apiCredentialId',
          'ORDER_API_CREDENTIAL_MISSING',
          {
            orderId: order.id,
            accountId: order.accountId,
          },
        );
      }

      const ack = await this.gateway.placeOrderForAccountCredential(
        Number(order.accountId),
        apiCredentialId,
        placeInput.accountId,
        placeInput,
      );

      const updated = await this.orders.updateStatusFromExpected(
        order.id,
        [OrderStatus.Submitting],
        {
          status: OrderStatus.Accepted,
          brokerOrderId: ack.vendorOrderId,
          externalOrderId: ack.vendorOrderId,
          acceptedAt: new Date(),
        },
      );

      if (!updated) {
        const attached = await this.orders.attachBrokerOrderIdFromExpected(
          order.id,
          [
            OrderStatus.Submitting,
            OrderStatus.CancelRequested,
            OrderStatus.CancelSubmitting,
          ],
          ack.vendorOrderId,
        );
        this.logger.warn(
          `pickup-requested order id=${order.id} accepted ack ignored because status is no longer SUBMITTING; brokerOrderId attach=${attached}`,
        );

        return;
      }

      await this.publishPlaced(order, ack.vendorOrderId);
    } catch (err) {
      await this.failClaimedOrder(order, err);
    }
  }

  private async failClaimedOrder(order: OrderModel, err: unknown): Promise<void> {
    const code = err instanceof DomainError ? err.code : 'PLACE_ORDER_FAILED';
    const message = err instanceof Error ? err.message : String(err);
    // Vendor refused → REJECTED (terminal but vendor-side).
    // System / infra/lock error → FAILED (terminal but our side). Lock acquisition
    // failure happens before the broker call, so closing as FAILED avoids a
    // SUBMITTING orphan without risking a duplicate broker order.
    const isRejection = code === 'VENDOR_REJECTED';
    const nextStatus = isRejection ? OrderStatus.Rejected : OrderStatus.Failed;

    const updated = await this.orders.updateStatusFromExpected(
      order.id,
      [OrderStatus.Submitting],
      {
        status: nextStatus,
        failedAt: new Date(),
        failureReason: message.slice(0, 1000),
      },
    );

    if (!updated) {
      this.logger.warn(
        `pickup-requested order id=${order.id} ${nextStatus} ignored because status is no longer SUBMITTING: code=${code} msg=${message}`,
      );

      return;
    }

    this.logger.warn(
      `pickup-requested order id=${order.id} ${nextStatus}: code=${code} msg=${message}`,
    );

    await this.publishFailed(order, code, message).catch((publishErr) => {
      this.logger.warn(
        `order.failed produce failed orderId=${order.id}: ${
          publishErr instanceof Error ? publishErr.message : publishErr
        }`,
      );
    });
  }

  private async withAccountOrderLock(
    accountId: number,
    run: () => Promise<void>,
  ): Promise<void> {
    const previous = this.accountChains.get(accountId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    const tail = previous.catch(() => undefined).then(() => current);
    this.accountChains.set(accountId, tail);

    await previous.catch(() => undefined);
    try {
      await run();
    } finally {
      release();
      if (this.accountChains.get(accountId) === tail) {
        this.accountChains.delete(accountId);
      }
    }
  }

  private toPlaceInput(order: OrderModel): Parameters<
    BrokerageVendor['placeOrderForAccount']
  >[1] {
    const side = order.orderType === OrderType.Buy ? 'buy' : 'sell';
    const type = order.orderMethod === OrderMethod.Limit ? 'limit' : 'market';
    const quantity = Number(order.quantity);
    const price = order.price !== null ? Number(order.price) : undefined;
    const accountExternalId = order.accountExternalId?.trim();
    const symbol =
      typeof order.rawRequest?.symbol === 'string' ? order.rawRequest.symbol.trim() : '';

    if (!accountExternalId) {
      throw new DomainError(
        'manual order is missing accountExternalId; refusing to send internal account id to broker',
        'ORDER_ACCOUNT_EXTERNAL_ID_MISSING',
        { orderId: order.id, accountId: order.accountId },
      );
    }
    if (!symbol) {
      throw new DomainError('manual order is missing symbol', 'ORDER_SYMBOL_MISSING', {
        orderId: order.id,
      });
    }

    return {
      accountId: accountExternalId,
      clientOrderId: order.clientOrderId ?? `order-${order.id}`,
      symbol,
      side,
      type,
      quantity,
      price,
    };
  }

  private async publishPlaced(order: OrderModel, vendorOrderId: string): Promise<void> {
    const symbol = (order.rawRequest?.symbol as string | undefined) ?? '';
    const payload: OrderPlacedPayload = {
      accountExternalId: requireAccountExternalId(order),
      brokerage: toEventBrokerage(order.brokerage),
      marketEnv: toEventMarketEnv(order.marketEnv),
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
      accountExternalId: requireAccountExternalId(order),
      brokerage: toEventBrokerage(order.brokerage),
      marketEnv: toEventMarketEnv(order.marketEnv),
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

  private async withDistributedAccountLock(
    accountId: number,
    run: () => Promise<void>,
  ): Promise<void> {
    if (!this.redis) {
      await run();

      return;
    }

    const key = `executor:order-lock:account:${accountId}`;
    const owner = randomUUID();
    const deadline = Date.now() + ACCOUNT_LOCK_WAIT_MS;

    while (true) {
      const acquired = await this.redis.set(key, owner, 'PX', ACCOUNT_LOCK_TTL_MS, 'NX');
      if (acquired === 'OK') break;

      if (Date.now() >= deadline) {
        throw new DomainError(
          `timed out waiting for executor account lock accountId=${accountId}`,
          'EXECUTOR_ACCOUNT_LOCK_TIMEOUT',
          { accountId, waitMs: ACCOUNT_LOCK_WAIT_MS },
        );
      }

      await sleep(ACCOUNT_LOCK_POLL_MS);
    }

    try {
      await run();
    } finally {
      await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, key, owner).catch((err) => {
        this.logger.warn(
          `executor account lock release failed accountId=${accountId}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      });
    }
  }
}

function toEventBrokerage(value: OrderModel['brokerage']): 'kiwoom' {
  return value === 'KIWOOM' ? 'kiwoom' : 'kiwoom';
}

function toEventMarketEnv(value: OrderModel['marketEnv']): 'mock' | 'production' {
  return value === 'PRODUCTION' ? 'production' : 'mock';
}

function requireAccountExternalId(order: OrderModel): string {
  const accountExternalId = order.accountExternalId?.trim();
  if (!accountExternalId) {
    throw new DomainError(
      'order is missing accountExternalId; refusing to publish internal account id',
      'ORDER_ACCOUNT_EXTERNAL_ID_MISSING',
      { orderId: order.id, accountId: order.accountId },
    );
  }

  return accountExternalId;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
