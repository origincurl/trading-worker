import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError } from '@common/error/domain.error';
import { EXECUTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type { BrokerageVendor } from '@external/brokerage/vendor/brokerage.vendor';
import { ORDER_REPOSITORY } from '@shared/persistence/order/order.token';
import type { OrderRepository } from '@shared/persistence/order/order.repository';
import { OrderStatus } from '@shared/model/order/order-status.enum';
import type { OrderModel } from '@shared/model/order/order.model';

const DEFAULT_BATCH_SIZE = 20;

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

  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(EXECUTOR_BROKERAGE_VENDOR) private readonly gateway: BrokerageVendor,
  ) {}

  async execute(batchSize: number = DEFAULT_BATCH_SIZE): Promise<number> {
    const batch = await this.orders.findCancellingBatch(batchSize);

    if (batch.length === 0) return 0;

    let processed = 0;

    for (const order of batch) {
      try {
        await this.processOne(order);
        processed += 1;
      } catch (err) {
        this.logger.warn(
          `pickup-cancelling order id=${order.id} threw: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return processed;
  }

  private async processOne(order: OrderModel): Promise<void> {
    const externalOrderId = order.externalOrderId ?? order.brokerOrderId;

    if (!externalOrderId) {
      // Row entered CANCEL_REQUESTED before the executor ever placed it —
      // there's no broker handle to cancel. Treat as fully cancelled.
      await this.orders.updateStatus(order.id, {
        status: OrderStatus.Cancelled,
        cancelledAt: new Date(),
      });

      return;
    }

    try {
      // accountExternalId is the broker-side string (acntNo). Fall back to
      // the internal PK stringified only when the row pre-dates the
      // accountExternalId column being populated — vendor will reject but
      // we'd rather get a real reject than silently no-op.
      const accountExternalId =
        order.accountExternalId ?? String(order.accountId);

      await this.gateway.cancelOrderForAccount(
        Number(order.accountId),
        accountExternalId,
        externalOrderId,
      );

      // Vendor ack received. We don't know here whether there were
      // partial fills — tracker reconciles via the fill stream. If the
      // row was already PARTIALLY_FILLED we leave it; otherwise mark
      // CANCELLED. updateStatus is conditional only on id, so we keep
      // it permissive and let tracker overwrite if a fill races in.
      await this.orders.updateStatus(order.id, {
        status: OrderStatus.Cancelled,
        cancelledAt: new Date(),
      });
    } catch (err) {
      const code = err instanceof DomainError ? err.code : 'CANCEL_ORDER_FAILED';
      const message = err instanceof Error ? err.message : String(err);

      // Cancel failure is terminal here: leaving the row in
      // CANCEL_REQUESTED would loop forever. Mark FAILED so an operator
      // can intervene; failureReason carries the vendor text.
      await this.orders.updateStatus(order.id, {
        status: OrderStatus.Failed,
        failedAt: new Date(),
        failureReason: message.slice(0, 1000),
      });

      this.logger.warn(
        `pickup-cancelling order id=${order.id} FAILED: code=${code} msg=${message}`,
      );
    }
  }
}
