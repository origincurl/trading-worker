import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DomainError } from '@common/error/domain.error';
import { EXECUTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type { BrokerageVendor } from '@external/brokerage/vendor/brokerage.vendor';
import { REDIS_CLIENT, type RedisClientToken } from '@shared/cache/redis.module';
import { ORDER_REPOSITORY } from '@shared/persistence/order/order.token';
import type { OrderRepository } from '@shared/persistence/order/order.repository';
import { OrderStatus } from '@shared/model/order/order-status.enum';
import type { OrderModel } from '@shared/model/order/order.model';

const DEFAULT_BATCH_SIZE = 20;
const MISSING_BROKER_HANDLE_WAIT_MS = 22_000;
const MISSING_BROKER_HANDLE_POLL_MS = 250;
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

// Phase J: drains cancellation claims. The BE flips the row to
// CANCEL_REQUESTED when a user / admin asks to cancel; the repository
// atomically claims it as CANCEL_SUBMITTING before this loop hits the vendor
// cancel REST path keyed by the row's externalOrderId. Terminal status (CANCELLED /
// PARTIALLY_FILLED-then-CANCELLED) is set by tracker once the fill stream
// confirms — we only stamp CANCELLED on a clean vendor ack with no fills,
// and FAILED when the vendor / infra blows up so the row leaves the
// cancellation queue.
@Injectable()
export class PickupCancellingOrdersUsecase {
  private readonly logger = new Logger(PickupCancellingOrdersUsecase.name);

  private readonly accountChains = new Map<number, Promise<void>>();

  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(EXECUTOR_BROKERAGE_VENDOR) private readonly gateway: BrokerageVendor,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: RedisClientToken,
  ) {}

  async execute(batchSize: number = DEFAULT_BATCH_SIZE): Promise<number> {
    const batch = await this.orders.findCancellingBatch(batchSize);

    if (batch.length === 0) return 0;

    const results = await Promise.allSettled(
      batch.map(async (order) => {
        await this.processOne(order);
        return true;
      }),
    );

    let processed = 0;
    for (let i = 0; i < results.length; i += 1) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        processed += 1;
      } else {
        const order = batch[i];
        const err = result.reason;
        this.logger.warn(
          `pickup-cancelling order id=${order.id} threw: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return processed;
  }

  private async processOne(order: OrderModel): Promise<void> {
    const externalOrderId =
      order.externalOrderId ??
      order.brokerOrderId ??
      (await this.waitForBrokerHandle(order.id));

    if (!externalOrderId) {
      // Row entered CANCEL_REQUESTED before the executor ever placed it —
      // there's no broker handle to cancel. We wait one REST timeout first
      // because a kill switch may have flipped SUBMITTING -> CANCEL_REQUESTED
      // while the place ACK was still in flight; in that case the requested
      // pickup attaches the broker handle asynchronously and this path must
      // send a real vendor cancel instead of creating a phantom order.
      await this.orders.updateStatusFromExpected(
        order.id,
        [OrderStatus.CancelSubmitting],
        {
          status: OrderStatus.Cancelled,
          cancelledAt: new Date(),
        },
      );

      return;
    }

    try {
      await this.withAccountOrderLock(Number(order.accountId), () =>
        this.withDistributedAccountLock(Number(order.accountId), () =>
          this.cancelClaimedOrder(order, externalOrderId),
        ).catch((err) => this.failCancelClaim(order, err)),
      );
    } catch (err) {
      await this.failCancelClaim(order, err);
    }
  }

  private async cancelClaimedOrder(
    order: OrderModel,
    externalOrderId: string,
  ): Promise<void> {
    const accountExternalId = order.accountExternalId?.trim();
    if (!accountExternalId) {
      throw new DomainError(
        'cancel order is missing accountExternalId; refusing to send internal account id to broker',
        'ORDER_ACCOUNT_EXTERNAL_ID_MISSING',
        { orderId: order.id, accountId: order.accountId },
      );
    }
    const apiCredentialId = Number(order.apiCredentialId);
    if (!Number.isInteger(apiCredentialId) || apiCredentialId <= 0) {
      throw new DomainError(
        'cancel order is missing apiCredentialId',
        'ORDER_API_CREDENTIAL_MISSING',
        { orderId: order.id, accountId: order.accountId },
      );
    }

    await this.gateway.cancelOrderForAccountCredential(
      Number(order.accountId),
      apiCredentialId,
      accountExternalId,
      externalOrderId,
      typeof order.rawRequest?.symbol === 'string' ? order.rawRequest.symbol.trim() : undefined,
      Number(order.remainingQuantity ?? order.quantity),
    );

    // Vendor ack received. We only close the cancellation claim we own.
    // If tracker/reconciliation moves the row first, this write is a no-op
    // and we avoid clobbering fill-derived state.
    const updated = await this.orders.updateStatusFromExpected(
      order.id,
      [OrderStatus.CancelSubmitting],
      {
        status: OrderStatus.Cancelled,
        cancelledAt: new Date(),
      },
    );
    if (!updated) {
      this.logger.warn(
        `pickup-cancelling order id=${order.id} cancel ack ignored because status is no longer CANCEL_SUBMITTING`,
      );
    }
  }

  private async failCancelClaim(order: OrderModel, err: unknown): Promise<void> {
    const code = err instanceof DomainError ? err.code : 'CANCEL_ORDER_FAILED';
    const message = err instanceof Error ? err.message : String(err);

    // Cancel failure is terminal here: leaving the row in
    // CANCEL_REQUESTED would loop forever. Mark FAILED so an operator
    // can intervene; failureReason carries the vendor text.
    const updated = await this.orders.updateStatusFromExpected(
      order.id,
      [OrderStatus.CancelSubmitting],
      {
        status: OrderStatus.Failed,
        failedAt: new Date(),
        failureReason: message.slice(0, 1000),
      },
    );
    if (!updated) {
      this.logger.warn(
        `pickup-cancelling order id=${order.id} FAILED ignored because status is no longer CANCEL_SUBMITTING: code=${code} msg=${message}`,
      );

      return;
    }

    this.logger.warn(
      `pickup-cancelling order id=${order.id} FAILED: code=${code} msg=${message}`,
    );
  }

  private async waitForBrokerHandle(orderId: number): Promise<string | null> {
    const deadline = Date.now() + MISSING_BROKER_HANDLE_WAIT_MS;

    while (Date.now() < deadline) {
      await sleep(MISSING_BROKER_HANDLE_POLL_MS);
      const current = await this.orders.findOrderById(orderId);
      const handle = current?.externalOrderId ?? current?.brokerOrderId ?? null;
      if (handle) return handle;
      if (!current || current.status !== OrderStatus.CancelSubmitting) return null;
    }

    return null;
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

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
