import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@shared/persistence/base.entity';

export type PositionBookSourceType = 'STRATEGY' | 'MANUAL';

@Entity({ name: 'position_books' })
@Index('ix_position_books_account_stock', ['accountId', 'stockId'])
export class PositionBookEntity extends BaseEntity {
  @Column({ name: 'account_id', type: 'bigint' })
  accountId!: number;

  @Column({ name: 'stock_id', type: 'bigint' })
  stockId!: number;

  @Column({ name: 'source_type', type: 'varchar', length: 16 })
  sourceType!: PositionBookSourceType;

  @Column({ name: 'account_strategy_id', type: 'bigint', nullable: true })
  accountStrategyId!: number | null;

  @Column({ name: 'strategy_id', type: 'bigint', nullable: true })
  strategyId!: number | null;

  @Column({ name: 'requested_by_user_id', type: 'bigint', nullable: true })
  requestedByUserId!: number | null;

  @Column({ type: 'decimal', precision: 24, scale: 8 })
  quantity!: string;

  @Column({ name: 'average_price', type: 'decimal', precision: 20, scale: 6 })
  averagePrice!: string;

  @Column({ name: 'cost_amount', type: 'decimal', precision: 24, scale: 6 })
  costAmount!: string;

  @Column({ name: 'realized_amount', type: 'decimal', precision: 24, scale: 6 })
  realizedAmount!: string;

  @Column({ name: 'last_fill_id', type: 'bigint', nullable: true })
  lastFillId!: number | null;

  @Column({ name: 'last_filled_at', type: 'timestamptz', nullable: true })
  lastFilledAt!: Date | null;
}
