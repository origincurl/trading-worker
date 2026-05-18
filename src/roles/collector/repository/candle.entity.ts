import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '@shared/persistence/base.entity';

// `candle_1m` row. PK on (provider, market_env, symbol, bucket_start)
// enables ON CONFLICT upsert with realtime-priority dataSource policy.
@Entity({ name: 'candle_1m' })
@Unique('uq_candle_1m_bucket', ['provider', 'marketEnv', 'symbol', 'bucketStart'])
@Index('ix_candle_1m_symbol_bucket', ['symbol', 'bucketStart'])
export class CandleEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 32 })
  provider!: string;

  @Column({ name: 'market_env', type: 'varchar', length: 16 })
  marketEnv!: 'mock' | 'production';

  @Column({ type: 'varchar', length: 32 })
  symbol!: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  market!: string | null;

  @Column({ name: 'interval_type', type: 'varchar', length: 8 })
  intervalType!: '1m';

  @Column({ name: 'bucket_start', type: 'timestamptz' })
  bucketStart!: Date;

  @Column({ name: 'bucket_end', type: 'timestamptz' })
  bucketEnd!: Date;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  open!: number;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  high!: number;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  low!: number;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  close!: number;

  @Column({ type: 'numeric', precision: 24, scale: 4 })
  volume!: number;

  @Column({ name: 'tick_count', type: 'integer' })
  tickCount!: number;

  @Column({ name: 'first_source_ts', type: 'timestamptz' })
  firstSourceTs!: Date;

  @Column({ name: 'last_source_ts', type: 'timestamptz' })
  lastSourceTs!: Date;

  @Column({ name: 'cum_vol_first', type: 'numeric', precision: 24, scale: 4, nullable: true })
  cumVolFirst!: number | null;

  @Column({ name: 'cum_vol_last', type: 'numeric', precision: 24, scale: 4, nullable: true })
  cumVolLast!: number | null;

  @Column({ name: 'cum_vol_anomalies', type: 'integer', default: 0 })
  cumVolAnomalies!: number;

  @Column({ name: 'data_source', type: 'varchar', length: 16 })
  dataSource!: 'realtime' | 'catchup';
}
