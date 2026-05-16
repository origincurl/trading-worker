import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '@shared/persistence/base.entity';

export type OrderAttemptStatus = 'pending' | 'accepted' | 'rejected' | 'failed';

@Entity({ name: 'order_attempt' })
@Unique('uq_order_attempt_client', ['provider', 'marketEnv', 'clientOrderId'])
@Index('ix_order_attempt_account_created', ['accountId', 'createdAt'])
export class OrderAttemptEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 32 })
  provider!: string;

  @Column({ name: 'market_env', type: 'varchar', length: 16 })
  marketEnv!: 'mock' | 'production';

  @Column({ name: 'account_id', type: 'varchar', length: 64 })
  accountId!: string;

  @Column({ name: 'client_order_id', type: 'varchar', length: 64 })
  clientOrderId!: string;

  @Column({ name: 'signal_id', type: 'varchar', length: 64 })
  signalId!: string;

  @Column({ type: 'varchar', length: 32 })
  symbol!: string;

  @Column({ type: 'varchar', length: 8 })
  side!: 'buy' | 'sell';

  @Column({ name: 'order_type', type: 'varchar', length: 16 })
  orderType!: 'market' | 'limit';

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  quantity!: number;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
  price!: number | null;

  @Column({ type: 'varchar', length: 16 })
  status!: OrderAttemptStatus;

  @Column({ name: 'vendor_order_id', type: 'varchar', length: 64, nullable: true })
  vendorOrderId!: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 64, nullable: true })
  errorCode!: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;
}
