import { Inject, Injectable } from '@nestjs/common';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { ulid } from 'ulid';
import {
  ORDER_ATTEMPT_REPOSITORY,
  type OrderAttemptRepository,
} from '@shared/persistence/order/order-attempt.repository';
import type { OrderIntentSide, OrderIntentType } from '@shared/event/signal-detected.event';

export interface PrepareAttemptInput {
  readonly signalId: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly side: OrderIntentSide;
  readonly orderType: OrderIntentType;
  readonly quantity: number;
  readonly price?: number;
  readonly clientOrderIdHint?: string;
}

export interface PrepareAttemptResult {
  readonly clientOrderId: string;
  readonly outcome: 'created' | 'duplicate';
}

// Owns DB-side order lifecycle. PlaceOrderUsecase calls prepareAttempt
// before invoking the vendor gateway, then updateAttempt with the
// vendor's response. clientOrderId is generated locally so vendor
// rejection on a duplicate is impossible by construction.
@Injectable()
export class ExecutorOrderService {
  constructor(
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
    @Inject(ORDER_ATTEMPT_REPOSITORY) private readonly repo: OrderAttemptRepository,
  ) {}

  async prepareAttempt(input: PrepareAttemptInput): Promise<PrepareAttemptResult> {
    const clientOrderId = input.clientOrderIdHint ?? ulid();

    const outcome = await this.repo.createAttempt({
      provider: 'kiwoom',
      marketEnv: this.kiwoom.marketEnv,
      accountId: input.accountId,
      clientOrderId,
      signalId: input.signalId,
      symbol: input.symbol,
      side: input.side,
      orderType: input.orderType,
      quantity: input.quantity,
      price: input.price,
    });

    return { clientOrderId, outcome };
  }

  async markAccepted(clientOrderId: string, vendorOrderId: string): Promise<void> {
    await this.repo.updateAttempt({
      clientOrderId,
      status: 'accepted',
      vendorOrderId,
    });
  }

  async markFailed(clientOrderId: string, errorCode: string, errorMessage: string): Promise<void> {
    await this.repo.updateAttempt({
      clientOrderId,
      status: 'failed',
      errorCode,
      errorMessage,
    });
  }
}
