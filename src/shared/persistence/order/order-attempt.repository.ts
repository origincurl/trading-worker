import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { OrderIntentSide, OrderIntentType } from '@shared/event/signal-detected.event';
import { OrderAttemptEntity, type OrderAttemptStatus } from './order-attempt.entity';

// ─────────────────────────────────────────────────────────────────────────
// `order_attempt` is the WORKER-LOCAL audit log of vendor order-place
// calls (one row per submission, keyed by client_order_id). It is
// **distinct** from the BE-shared `orders` table mirrored by
// `OrderEntity` / `OrderRepository` in this folder: orders holds the
// canonical order lifecycle (REQUESTED → ACCEPTED → FILLED), attempts
// holds per-call vendor outcome for retry / diagnostic purposes.
// ─────────────────────────────────────────────────────────────────────────
export const ORDER_ATTEMPT_REPOSITORY = Symbol('ORDER_ATTEMPT_REPOSITORY');

export interface CreateAttemptInput {
  readonly provider: 'kiwoom';
  readonly marketEnv: 'mock' | 'production';
  readonly accountId: string;
  readonly clientOrderId: string;
  readonly signalId: string;
  readonly symbol: string;
  readonly side: OrderIntentSide;
  readonly orderType: OrderIntentType;
  readonly quantity: number;
  readonly price?: number;
}

export interface UpdateAttemptInput {
  readonly clientOrderId: string;
  readonly status: OrderAttemptStatus;
  readonly vendorOrderId?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export interface OrderAttemptRepository {
  createAttempt(input: CreateAttemptInput): Promise<'created' | 'duplicate'>;
  updateAttempt(input: UpdateAttemptInput): Promise<void>;
}

@Injectable()
export class OrderAttemptRepositoryImpl implements OrderAttemptRepository {
  private readonly logger = new Logger(OrderAttemptRepositoryImpl.name);

  constructor(
    @Optional()
    @InjectRepository(OrderAttemptEntity)
    private readonly attempts?: Repository<OrderAttemptEntity>,
  ) {}

  async createAttempt(input: CreateAttemptInput): Promise<'created' | 'duplicate'> {
    if (!this.attempts) {
      this.logger.debug('persistence disabled — order attempt write skipped');

      return 'created';
    }

    const existing = await this.attempts.findOne({
      where: {
        provider: input.provider,
        marketEnv: input.marketEnv,
        clientOrderId: input.clientOrderId,
      },
    });

    if (existing) return 'duplicate';

    await this.attempts.save(
      this.attempts.create({
        provider: input.provider,
        marketEnv: input.marketEnv,
        accountId: input.accountId,
        clientOrderId: input.clientOrderId,
        signalId: input.signalId,
        symbol: input.symbol,
        side: input.side,
        orderType: input.orderType,
        quantity: input.quantity,
        price: input.price ?? null,
        status: 'pending',
        vendorOrderId: null,
        errorCode: null,
        errorMessage: null,
      }),
    );

    return 'created';
  }

  async updateAttempt(input: UpdateAttemptInput): Promise<void> {
    if (!this.attempts) return;

    await this.attempts.update(
      { clientOrderId: input.clientOrderId },
      {
        status: input.status,
        vendorOrderId: input.vendorOrderId ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
      },
    );
  }
}
