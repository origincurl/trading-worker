import type { Brokerage } from '@shared/model/account/brokerage.enum';
import type { MarketEnv } from '@shared/model/api-credential/market-env.enum';
import type { OrderMethod } from '@shared/model/order/order-method.enum';
import type { OrderStatus } from '@shared/model/order/order-status.enum';
import type { OrderType } from '@shared/model/order/order-type.enum';
import type { OrderModel } from '@shared/model/order/order.model';

// Input for inserting an order produced by an executor decision. Aligned
// with BE OrderEntity columns; nullable fields default to null in impl.
export interface CreateDecisionOrderInput {
  readonly accountId: number;
  readonly decisionId: number;
  readonly accountStrategyId: number | null;
  readonly strategyId: number | null;
  readonly stockId: number;
  readonly clientOrderId: string | null;
  readonly brokerage: Brokerage | null;
  readonly marketEnv: MarketEnv | null;
  readonly accountExternalId: string | null;
  readonly orderType: OrderType;
  readonly orderMethod: OrderMethod;
  readonly status: OrderStatus;
  readonly quantity: string;
  readonly price: string | null;
  readonly orderAmount: string | null;
  readonly isPaper: boolean;
  readonly requestedAt: Date | null;
  readonly apiCredentialId: number | null;
  readonly requestedByUserId: number | null;
}

// Partial update of an order row. Worker translates vendor responses
// (ACCEPTED / FILLED / CANCELLED / REJECTED / FAILED) into these.
export interface UpdateOrderRepositoryInput {
  readonly status?: OrderStatus;
  readonly brokerOrderId?: string | null;
  readonly externalOrderId?: string | null;
  readonly filledQuantity?: string;
  readonly remainingQuantity?: string | null;
  readonly averageFillPrice?: string | null;
  readonly filledAmount?: string | null;
  readonly feeAmount?: string | null;
  readonly taxAmount?: string | null;
  readonly acceptedAt?: Date | null;
  readonly filledAt?: Date | null;
  readonly cancelRequestedAt?: Date | null;
  readonly cancelledAt?: Date | null;
  readonly failedAt?: Date | null;
  readonly failureReason?: string | null;
  readonly rawResponse?: Record<string, unknown> | null;
}

export interface OrderRepository {
  // Batch pickup for executor / tracker pollers. Uses SKIP LOCKED so
  // multiple worker pods can pull non-overlapping slices safely.
  findRequestedBatch(batchSize: number): Promise<OrderModel[]>;
  findCancellingBatch(batchSize: number): Promise<OrderModel[]>;
  // Insert an order row driven by an executor decision.
  createDecisionOrder(input: CreateDecisionOrderInput): Promise<OrderModel>;
  // Atomic status / lifecycle update. Returns true if a row was matched.
  updateStatus(id: number, fields: UpdateOrderRepositoryInput): Promise<boolean>;
}
