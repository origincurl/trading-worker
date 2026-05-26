import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@shared/persistence/base.entity';

export type UnmatchedOrderFillStatus = 'PENDING' | 'RESOLVED' | 'DEAD_LETTER';

@Entity({ name: 'unmatched_order_fills' })
@Index('uq_unmatched_order_fills_external_fill_id', ['externalFillId'], { unique: true })
@Index('ix_unmatched_order_fills_retry', ['status', 'nextRetryAt'])
export class UnmatchedOrderFillEntity extends BaseEntity {
  @Column({ name: 'external_fill_id', type: 'varchar', length: 255 })
  externalFillId!: string;

  @Column({ type: 'varchar', length: 32 })
  provider!: string;

  @Column({ name: 'market_env', type: 'varchar', length: 16 })
  marketEnv!: 'mock' | 'production';

  @Column({ name: 'account_id', type: 'varchar', length: 64 })
  accountId!: string;

  @Column({ name: 'vendor_order_id', type: 'varchar', length: 64, nullable: true })
  vendorOrderId!: string | null;

  @Column({ name: 'client_order_id', type: 'varchar', length: 100, nullable: true })
  clientOrderId!: string | null;

  @Column({ type: 'varchar', length: 32 })
  symbol!: string;

  @Column({ type: 'varchar', length: 32 })
  reason!: string;

  @Column({ type: 'varchar', length: 24 })
  status!: UnmatchedOrderFillStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'next_retry_at', type: 'timestamptz', nullable: true })
  nextRetryAt!: Date | null;

  @Column({ name: 'resolved_order_id', type: 'bigint', nullable: true })
  resolvedOrderId!: number | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;
}
