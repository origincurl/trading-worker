import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderStatus } from '@shared/model/order/order-status.enum';
import type { OrderModel } from '@shared/model/order/order.model';
import { OrderEntity } from './order.entity';
import type {
  CreateDecisionOrderInput,
  OrderRepository,
  UpdateOrderRepositoryInput,
} from './order.repository';

@Injectable()
export class OrderRepositoryImpl implements OrderRepository {
  constructor(
    @Optional()
    @InjectRepository(OrderEntity)
    private readonly repo?: Repository<OrderEntity>,
  ) {}

  async findRequestedBatch(batchSize: number): Promise<OrderModel[]> {
    return this.findBatch(OrderStatus.Requested, batchSize);
  }

  async findCancellingBatch(batchSize: number): Promise<OrderModel[]> {
    return this.findBatch(OrderStatus.CancelRequested, batchSize);
  }

  async createDecisionOrder(input: CreateDecisionOrderInput): Promise<OrderModel> {
    if (!this.repo) {
      // Persistence disabled — return a transient model so caller can
      // proceed with its log/dispatch flow. Phase B reviews will harden
      // this once executor wiring lands.
      const placeholder = Object.assign(new (class {})() as OrderModel, {
        ...input,
        id: 0,
        externalOrderId: null,
        brokerOrderId: null,
        filledQuantity: '0',
        remainingQuantity: input.quantity,
        averageFillPrice: null,
        filledAmount: null,
        feeAmount: null,
        taxAmount: null,
        acceptedAt: null,
        filledAt: null,
        cancelledAt: null,
        failedAt: null,
        failureReason: null,
        rawRequest: null,
        rawResponse: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return placeholder;
    }

    const entity = this.repo.create({
      accountId: input.accountId,
      decisionId: input.decisionId,
      accountStrategyId: input.accountStrategyId,
      strategyId: input.strategyId,
      stockId: input.stockId,
      externalOrderId: null,
      clientOrderId: input.clientOrderId,
      requestedByUserId: input.requestedByUserId,
      apiCredentialId: input.apiCredentialId,
      brokerage: input.brokerage,
      marketEnv: input.marketEnv,
      accountExternalId: input.accountExternalId,
      brokerOrderId: null,
      orderType: input.orderType,
      orderMethod: input.orderMethod,
      status: input.status,
      quantity: input.quantity,
      filledQuantity: '0',
      remainingQuantity: input.quantity,
      price: input.price,
      averageFillPrice: null,
      orderAmount: input.orderAmount,
      filledAmount: null,
      feeAmount: null,
      taxAmount: null,
      isPaper: input.isPaper,
      requestedAt: input.requestedAt,
      acceptedAt: null,
      filledAt: null,
      cancelledAt: null,
      failedAt: null,
      failureReason: null,
      rawRequest: null,
      rawResponse: null,
    });

    const saved = await this.repo.save(entity);

    return saved.toModel();
  }

  async updateStatus(id: number, fields: UpdateOrderRepositoryInput): Promise<boolean> {
    if (!this.repo) return false;

    // Cast to any: TypeORM's QueryDeepPartialEntity rejects json columns
    // typed as Record<string, unknown> in strict mode. The runtime path
    // accepts plain objects (TypeORM serialises via JSON.stringify).
    const result = await this.repo.update({ id }, { ...fields } as Record<string, unknown>);

    return (result.affected ?? 0) > 0;
  }

  // SKIP LOCKED pickup for concurrent worker pods. Returns models — caller
  // typically updates status='SUBMITTING' immediately after.
  private async findBatch(status: OrderStatus, batchSize: number): Promise<OrderModel[]> {
    if (!this.repo || batchSize <= 0) return [];

    const rows = await this.repo
      .createQueryBuilder('o')
      .where('o.status = :status', { status })
      .orderBy('o.id', 'ASC')
      .limit(batchSize)
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .getMany();

    return rows.map((r) => r.toModel());
  }
}
