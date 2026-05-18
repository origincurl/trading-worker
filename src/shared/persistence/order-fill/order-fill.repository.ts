import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { OrderFilledPayload } from '@shared/event/order-filled.event';
import { OrderFillEntity } from './order-fill.entity';

export const ORDER_FILL_REPOSITORY = Symbol('ORDER_FILL_REPOSITORY');

export interface OrderFillRepository {
  upsertFill(payload: OrderFilledPayload): Promise<'inserted' | 'duplicate'>;
}

@Injectable()
export class OrderFillRepositoryImpl implements OrderFillRepository {
  private readonly logger = new Logger(OrderFillRepositoryImpl.name);

  constructor(
    @Optional()
    @InjectRepository(OrderFillEntity)
    private readonly fills?: Repository<OrderFillEntity>,
  ) {}

  async upsertFill(payload: OrderFilledPayload): Promise<'inserted' | 'duplicate'> {
    if (!this.fills) {
      this.logger.debug('persistence disabled — order_fill upsert skipped');

      return 'inserted';
    }

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
