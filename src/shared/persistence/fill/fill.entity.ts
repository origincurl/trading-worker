import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('fills')
@Index('uq_fills_external_fill_id', ['externalFillId'], {
  unique: true,
  where: 'external_fill_id IS NOT NULL',
})
export class FillEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'account_id', type: 'bigint' })
  accountId!: number;

  @Column({ name: 'order_id', type: 'bigint' })
  orderId!: number;

  @Column({ name: 'stock_id', type: 'bigint' })
  stockId!: number;

  @Column({ name: 'external_fill_id', type: 'varchar', length: 255, nullable: true })
  externalFillId!: string | null;

  @Column({ name: 'fill_type', type: 'varchar', length: 16 })
  fillType!: 'BUY' | 'SELL';

  @Column({ type: 'decimal', precision: 24, scale: 8 })
  quantity!: string;

  @Column({ type: 'decimal', precision: 20, scale: 6 })
  price!: string;

  @Column({ type: 'decimal', precision: 24, scale: 6 })
  amount!: string;

  @Column({ name: 'fee_amount', type: 'decimal', precision: 24, scale: 6, nullable: true })
  feeAmount!: string | null;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 24, scale: 6, nullable: true })
  taxAmount!: string | null;

  @Column({ name: 'net_amount', type: 'decimal', precision: 24, scale: 6, nullable: true })
  netAmount!: string | null;

  @Column({ name: 'is_paper', type: 'boolean' })
  isPaper!: boolean;

  @Column({ name: 'filled_at', type: 'timestamp' })
  filledAt!: Date;

  @Column({ name: 'raw_data', type: 'json', nullable: true })
  rawData!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;
}
