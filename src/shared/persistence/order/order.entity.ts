import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Brokerage } from '@shared/model/account/brokerage.enum';
import { MarketEnv } from '@shared/model/api-credential/market-env.enum';
import { OrderMethod } from '@shared/model/order/order-method.enum';
import { OrderStatus } from '@shared/model/order/order-status.enum';
import { OrderType } from '@shared/model/order/order-type.enum';
import { OrderModel } from '@shared/model/order/order.model';

// ─────────────────────────────────────────────────────────────────────────
// BE-shared `orders` table — canonical order lifecycle owned by BE and
// mutated by both BE (REQUESTED inserts) and worker (status transitions
// after vendor calls + decision-driven order inserts from executor).
//
// Distinct from `OrderAttemptEntity` in the same folder, which is the
// worker-local audit log of each vendor place-order call. Do not
// conflate them — orders is the source of truth; order_attempt is a
// retry/diagnostic log.
// ─────────────────────────────────────────────────────────────────────────
@Entity('orders')
@Index('UQ_orders_account_client_order_id', ['accountId', 'clientOrderId'], {
  unique: true,
  where: 'client_order_id IS NOT NULL',
})
export class OrderEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId!: number;

  @Column({ name: 'decision_id', type: 'bigint', nullable: true })
  decisionId!: number | null;

  @Column({ name: 'account_strategy_id', type: 'bigint', nullable: true })
  accountStrategyId!: number | null;

  @Column({ name: 'strategy_id', type: 'bigint', nullable: true })
  strategyId!: number | null;

  @Column({ name: 'stock_id', type: 'bigint' })
  stockId!: number;

  @Column({ name: 'external_order_id', type: 'varchar', length: 255, nullable: true })
  externalOrderId!: string | null;

  @Column({ name: 'client_order_id', type: 'varchar', length: 100, nullable: true })
  clientOrderId!: string | null;

  @Column({ name: 'requested_by_user_id', type: 'bigint', nullable: true })
  requestedByUserId!: number | null;

  @Column({ name: 'api_credential_id', type: 'bigint', nullable: true })
  apiCredentialId!: number | null;

  @Column({ type: 'enum', enum: Brokerage, nullable: true })
  brokerage!: Brokerage | null;

  @Column({ name: 'market_env', type: 'enum', enum: MarketEnv, nullable: true })
  marketEnv!: MarketEnv | null;

  @Column({ name: 'account_external_id', type: 'varchar', length: 255, nullable: true })
  accountExternalId!: string | null;

  @Column({ name: 'broker_order_id', type: 'varchar', length: 255, nullable: true })
  brokerOrderId!: string | null;

  @Column({ name: 'order_type', type: 'enum', enum: OrderType })
  orderType!: OrderType;

  @Column({ name: 'order_method', type: 'enum', enum: OrderMethod })
  orderMethod!: OrderMethod;

  @Column({ type: 'enum', enum: OrderStatus })
  status!: OrderStatus;

  @Column({ type: 'decimal', precision: 24, scale: 8 })
  quantity!: string;

  @Column({ name: 'filled_quantity', type: 'decimal', precision: 24, scale: 8 })
  filledQuantity!: string;

  @Column({ name: 'remaining_quantity', type: 'decimal', precision: 24, scale: 8, nullable: true })
  remainingQuantity!: string | null;

  @Column({ type: 'decimal', precision: 20, scale: 6, nullable: true })
  price!: string | null;

  @Column({ name: 'average_fill_price', type: 'decimal', precision: 20, scale: 6, nullable: true })
  averageFillPrice!: string | null;

  @Column({ name: 'order_amount', type: 'decimal', precision: 24, scale: 6, nullable: true })
  orderAmount!: string | null;

  @Column({ name: 'filled_amount', type: 'decimal', precision: 24, scale: 6, nullable: true })
  filledAmount!: string | null;

  @Column({ name: 'fee_amount', type: 'decimal', precision: 24, scale: 6, nullable: true })
  feeAmount!: string | null;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 24, scale: 6, nullable: true })
  taxAmount!: string | null;

  @Column({ name: 'is_paper', type: 'boolean' })
  isPaper!: boolean;

  @Column({ name: 'requested_at', type: 'timestamp', nullable: true })
  requestedAt!: Date | null;

  @Column({ name: 'accepted_at', type: 'timestamp', nullable: true })
  acceptedAt!: Date | null;

  @Column({ name: 'filled_at', type: 'timestamp', nullable: true })
  filledAt!: Date | null;

  @Column({ name: 'cancel_requested_at', type: 'timestamp', nullable: true })
  cancelRequestedAt!: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamp', nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamp', nullable: true })
  failedAt!: Date | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason!: string | null;

  @Column({ name: 'raw_request', type: 'json', nullable: true })
  rawRequest!: Record<string, unknown> | null;

  @Column({ name: 'raw_response', type: 'json', nullable: true })
  rawResponse!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  toModel(): OrderModel {
    return Object.assign(new OrderModel(), this);
  }
}
