import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError } from '@common/error/domain.error';
import {
  BE_CONTROL_PLANE_CLIENT,
  type BeControlPlaneClient,
} from '@external/be-control-plane/client/be-control-plane.client';
import { EXECUTOR_BROKERAGE_GATEWAY } from '@external/brokerage/brokerage.token';
import type { BrokerageGateway } from '@external/brokerage/gateway/brokerage.gateway';
import { ExecutorOrderService } from '@roles/executor/service/executor-order.service';
import type { SignalDetectedJobPayload } from '@shared/event/signal-detected.event';

@Injectable()
export class PlaceOrderUsecase {
  private readonly logger = new Logger(PlaceOrderUsecase.name);

  private _placedCount = 0;

  private _rejectedCount = 0;

  private _lastSignalAt: Date | null = null;

  constructor(
    @Inject(EXECUTOR_BROKERAGE_GATEWAY) private readonly gateway: BrokerageGateway,
    @Inject(BE_CONTROL_PLANE_CLIENT) private readonly be: BeControlPlaneClient,
    private readonly orderService: ExecutorOrderService,
  ) {}

  placedCount(): number {
    return this._placedCount;
  }

  rejectedCount(): number {
    return this._rejectedCount;
  }

  lastSignalAt(): Date | null {
    return this._lastSignalAt;
  }

  async execute(payload: SignalDetectedJobPayload): Promise<void> {
    this._lastSignalAt = new Date();

    if (payload.quantity <= 0) {
      throw new DomainError('signal quantity must be > 0', 'SIGNAL_INVALID_QUANTITY', {
        signalId: payload.signalId,
        quantity: payload.quantity,
      });
    }

    if (payload.orderType === 'limit' && (payload.price === undefined || payload.price <= 0)) {
      throw new DomainError('limit order requires positive price', 'SIGNAL_INVALID_PRICE', {
        signalId: payload.signalId,
      });
    }

    const prepared = await this.orderService.prepareAttempt({
      signalId: payload.signalId,
      accountId: payload.accountId,
      symbol: payload.symbol,
      side: payload.side,
      orderType: payload.orderType,
      quantity: payload.quantity,
      price: payload.price,
      clientOrderIdHint: payload.clientOrderIdHint,
    });

    if (prepared.outcome === 'duplicate') {
      // BullMQ jobId = signalId catches most re-enqueues; this guards
      // against the rare case where the job ran past placement but
      // failed to ack and got re-delivered.
      this.logger.warn(
        `duplicate order attempt suppressed signalId=${payload.signalId} clientOrderId=${prepared.clientOrderId}`,
      );

      return;
    }

    // BE audit hook — fire-and-forget. BE retains its own copy of the
    // signal independent of worker outcome.
    await this.be
      .reportSignalDetected({
        signalId: payload.signalId,
        accountId: payload.accountId,
        symbol: payload.symbol,
        strategy: payload.strategy,
        detectedAt: payload.detectedAt,
        payload: { side: payload.side, quantity: payload.quantity, price: payload.price ?? null },
      })
      .catch((err) =>
        this.logger.warn(
          `BE reportSignalDetected failed: ${err instanceof Error ? err.message : err}`,
        ),
      );

    try {
      const ack = await this.gateway.placeOrder({
        accountId: payload.accountId,
        clientOrderId: prepared.clientOrderId,
        symbol: payload.symbol,
        side: payload.side,
        type: payload.orderType,
        quantity: payload.quantity,
        price: payload.price,
      });

      await this.orderService.markAccepted(prepared.clientOrderId, ack.vendorOrderId);

      this._placedCount += 1;
    } catch (err) {
      this._rejectedCount += 1;

      const code = err instanceof DomainError ? err.code : 'PLACE_ORDER_FAILED';
      const message = err instanceof Error ? err.message : String(err);

      await this.orderService.markFailed(prepared.clientOrderId, code, message);

      this.logger.warn(`placeOrder failed signalId=${payload.signalId}: ${message}`);
    }
  }
}
