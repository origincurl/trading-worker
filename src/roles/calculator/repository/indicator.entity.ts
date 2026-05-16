import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '@shared/persistence/base.entity';

@Entity({ name: 'indicator_1m' })
@Unique('uq_indicator_1m', [
  'provider',
  'marketEnv',
  'symbol',
  'bucketStart',
  'indicatorType',
  'windowSize',
])
@Index('ix_indicator_1m_symbol_type_bucket', ['symbol', 'indicatorType', 'bucketStart'])
export class IndicatorEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 32 })
  provider!: string;

  @Column({ name: 'market_env', type: 'varchar', length: 16 })
  marketEnv!: 'mock' | 'production';

  @Column({ type: 'varchar', length: 32 })
  symbol!: string;

  @Column({ name: 'bucket_start', type: 'timestamptz' })
  bucketStart!: Date;

  @Column({ name: 'indicator_type', type: 'varchar', length: 16 })
  indicatorType!: string;

  @Column({ name: 'window_size', type: 'integer' })
  windowSize!: number;

  @Column({ type: 'numeric', precision: 18, scale: 6, nullable: true })
  value!: number | null;
}
