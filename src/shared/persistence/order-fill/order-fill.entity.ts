import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@shared/persistence/base.entity';

@Entity({ name: 'order_fill' })
@Index('uq_order_fill_execution', ['provider', 'marketEnv', 'externalFillId'], {
  unique: true,
})
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

  @Column({ name: 'external_fill_id', type: 'varchar', length: 255 })
  externalFillId!: string;

  @Column({ name: 'client_order_id', type: 'varchar', length: 100, nullable: true })
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

  @Column({ name: 'live_published_at', type: 'timestamptz', nullable: true })
  livePublishedAt!: Date | null;

  @Column({ name: 'stream_published_at', type: 'timestamptz', nullable: true })
  streamPublishedAt!: Date | null;

  @Column({ name: 'publish_attempts', type: 'int', default: 0 })
  publishAttempts!: number;

  @Column({ name: 'publish_claimed_at', type: 'timestamptz', nullable: true })
  publishClaimedAt!: Date | null;

  @Column({ name: 'next_publish_at', type: 'timestamptz', nullable: true })
  nextPublishAt!: Date | null;

  @Column({ name: 'last_publish_error', type: 'text', nullable: true })
  lastPublishError!: string | null;
}
