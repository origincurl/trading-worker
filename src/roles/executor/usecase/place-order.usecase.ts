import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError } from '@common/error/domain.error';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { EXECUTOR_BROKERAGE_VENDOR } from '@external/brokerage/brokerage.token';
import type { BrokerageVendor } from '@external/brokerage/vendor/brokerage.vendor';
import { ExecutorOrderService } from '@roles/executor/service/executor-order.service';
import { BUS_STREAMS } from '@shared/bus/bus.token';
import type { BusStreams } from '@shared/bus/bus-streams.interface';
import {
  DECISION_MADE_EVENT_TYPE,
  DECISION_MADE_SCHEMA_VERSION,
  DECISION_MADE_STREAM,
  type DecisionMadePayload,
} from '@shared/event/decision-made.event';
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
import type { SignalDetectedJobPayload } from '@shared/event/signal-detected.event';

@Injectable()
export class PlaceOrderUsecase {
  private readonly logger = new Logger(PlaceOrderUsecase.name);

  private _placedCount = 0;

  private _rejectedCount = 0;

  private _lastSignalAt: Date | null = null;

  constructor(
    @Inject(EXECUTOR_BROKERAGE_VENDOR) private readonly gateway: BrokerageVendor,
    @Inject(BUS_STREAMS) private readonly streams: BusStreams,
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
    private readonly orderService: ExecutorOrderService,
    private readonly eventFactory: WorkerEventFactory,
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

    // Phase F: BE reportSignalDetected removed — decision.made stream
    // event below carries the same information; notifier persists it.

    // Stream `decision.made` ahead of vendor call so notifier sees the
    // decision even if the order then fails. Best-effort — a stream hiccup
    // must not block placement.
    await this.produceDecisionMade(payload).catch((err) =>
      this.logger.warn(
        `decision.made produce failed signalId=${payload.signalId}: ${err instanceof Error ? err.message : err}`,
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

      await this.produceOrderPlaced(payload, prepared.clientOrderId, ack.vendorOrderId).catch(
        (err) =>
          this.logger.warn(
            `order.placed produce failed signalId=${payload.signalId}: ${err instanceof Error ? err.message : err}`,
          ),
      );
    } catch (err) {
      this._rejectedCount += 1;

      const code = err instanceof DomainError ? err.code : 'PLACE_ORDER_FAILED';
      const message = err instanceof Error ? err.message : String(err);

      await this.orderService.markFailed(prepared.clientOrderId, code, message);

      this.logger.warn(`placeOrder failed signalId=${payload.signalId}: ${message}`);

      await this.produceOrderFailed(payload, prepared.clientOrderId, code, message).catch((e) =>
        this.logger.warn(
          `order.failed produce failed signalId=${payload.signalId}: ${e instanceof Error ? e.message : e}`,
        ),
      );
    }
  }

  private async produceDecisionMade(payload: SignalDetectedJobPayload): Promise<void> {
    const decisionPayload: DecisionMadePayload = {
      accountExternalId: payload.accountId,
      brokerage: payload.provider,
      marketEnv: this.kiwoom.marketEnv,
      sourceStrategyEventCode: payload.strategy,
      decisionType: payload.side === 'buy' ? 'BUY' : 'SELL',
      symbol: payload.symbol,
      score: null,
      quantity: String(payload.quantity),
      price: payload.price !== undefined ? String(payload.price) : null,
      amount: null,
      reason: null,
      decidedAt: payload.detectedAt,
    };

    const event = this.eventFactory.build({
      eventType: DECISION_MADE_EVENT_TYPE,
      schemaVersion: DECISION_MADE_SCHEMA_VERSION,
      role: 'executor',
      payload: decisionPayload,
    });

    await this.streams.produce(DECISION_MADE_STREAM, event);
  }

  private async produceOrderPlaced(
    payload: SignalDetectedJobPayload,
    clientOrderId: string,
    vendorOrderId: string,
  ): Promise<void> {
    const placedPayload: OrderPlacedPayload = {
      accountExternalId: payload.accountId,
      brokerage: payload.provider,
      marketEnv: this.kiwoom.marketEnv,
      externalOrderId: vendorOrderId,
      clientOrderId,
      symbol: payload.symbol,
      orderType: payload.side === 'buy' ? 'BUY' : 'SELL',
      orderMethod: payload.orderType === 'limit' ? 'LIMIT' : 'MARKET',
      quantity: String(payload.quantity),
      price: payload.price !== undefined ? String(payload.price) : null,
      placedAt: new Date().toISOString(),
    };

    const event = this.eventFactory.build({
      eventType: ORDER_PLACED_EVENT_TYPE,
      schemaVersion: ORDER_PLACED_SCHEMA_VERSION,
      role: 'executor',
      payload: placedPayload,
    });

    await this.streams.produce(ORDER_PLACED_STREAM, event);
  }

  private async produceOrderFailed(
    payload: SignalDetectedJobPayload,
    clientOrderId: string,
    errorCode: string,
    reason: string,
  ): Promise<void> {
    const failedPayload: OrderFailedPayload = {
      accountExternalId: payload.accountId,
      brokerage: payload.provider,
      marketEnv: this.kiwoom.marketEnv,
      clientOrderId,
      symbol: payload.symbol,
      reason,
      errorCode,
      failedAt: new Date().toISOString(),
    };

    const event = this.eventFactory.build({
      eventType: ORDER_FAILED_EVENT_TYPE,
      schemaVersion: ORDER_FAILED_SCHEMA_VERSION,
      role: 'executor',
      payload: failedPayload,
    });

    await this.streams.produce(ORDER_FAILED_STREAM, event);
  }
}
