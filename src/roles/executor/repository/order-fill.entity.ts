import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '@shared/persistence/base.entity';

@Entity({ name: 'order_fill' })
@Unique('uq_order_fill_vendor', ['provider', 'marketEnv', 'vendorOrderId'])
@Index('ix_order_fill_account_filled', ['accountId', 'filledAt'])
export class OrderFillEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 32 })
  provider!: string;

  @Column({ name: 'market_env', type: 'varchar', length: 16 })
  marketEnv!: 'mock' | 'production';

  @Column({ name: 'account_id', type: 'varchar', length: 64 })
  accountId!: string;

  @Column({ name: 'vendor_order_id', type: 'varchar', length: 64 })
  vendorOrderId!: string;

  @Column({ name: 'client_order_id', type: 'varchar', length: 64, nullable: true })
  clientOrderId!: string | null;

  @Column({ type: 'varchar', length: 32 })
  symbol!: string;

  @Column({ type: 'varchar', length: 8 })
  side!: 'buy' | 'sell';

  @Column({ name: 'filled_qty', type: 'numeric', precision: 18, scale: 4 })
  filledQty!: number;

  @Column({ name: 'filled_price', type: 'numeric', precision: 18, scale: 4 })
  filledPrice!: number;

  @Column({ name: 'filled_at', type: 'timestamptz' })
  filledAt!: Date;
}
