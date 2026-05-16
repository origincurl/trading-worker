import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { OrderFilledPayload } from '@shared/event/order-filled.event';
import type { OrderIntentSide, OrderIntentType } from '@shared/event/signal-detected.event';
import { OrderAttemptEntity, type OrderAttemptStatus } from './order-attempt.entity';
import { OrderFillEntity } from './order-fill.entity';

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');

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

export interface OrderRepository {
  createAttempt(input: CreateAttemptInput): Promise<'created' | 'duplicate'>;
  updateAttempt(input: UpdateAttemptInput): Promise<void>;
  upsertFill(payload: OrderFilledPayload): Promise<'inserted' | 'duplicate'>;
}

@Injectable()
export class OrderRepositoryImpl implements OrderRepository {
  private readonly logger = new Logger(OrderRepositoryImpl.name);

  constructor(
    @Optional()
    @InjectRepository(OrderAttemptEntity)
    private readonly attempts?: Repository<OrderAttemptEntity>,
    @Optional()
    @InjectRepository(OrderFillEntity)
    private readonly fills?: Repository<OrderFillEntity>,
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

  async upsertFill(payload: OrderFilledPayload): Promise<'inserted' | 'duplicate'> {
    if (!this.fills) return 'inserted';

    const existing = await this.fills.findOne({
      where: {
        provider: payload.provider,
        marketEnv: payload.marketEnv,
        vendorOrderId: payload.vendorOrderId,
      },
    });

    if (existing) return 'duplicate';

    await this.fills.save(
      this.fills.create({
        provider: payload.provider,
        marketEnv: payload.marketEnv,
        accountId: payload.accountId,
        vendorOrderId: payload.vendorOrderId,
        clientOrderId: payload.clientOrderId,
        symbol: payload.symbol,
        side: payload.side,
        filledQty: payload.filledQty,
        filledPrice: payload.filledPrice,
        filledAt: new Date(payload.filledAt),
      }),
    );

    return 'inserted';
  }
}
