import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@shared/persistence/base.entity';

@Entity({ name: 'collector_dead_letter' })
@Index('ix_collector_dl_received_at', ['receivedAt'])
@Index('ix_collector_dl_reason_received', ['reason', 'receivedAt'])
export class DeadLetterEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 32 })
  provider!: string;

  @Column({ name: 'market_env', type: 'varchar', length: 16 })
  marketEnv!: 'mock' | 'production';

  @Column({ name: 'worker_instance_id', type: 'varchar', length: 128 })
  workerInstanceId!: string;

  @Column({ type: 'varchar', length: 64 })
  reason!: string;

  @Column({ name: 'realtime_type', type: 'varchar', length: 16, nullable: true })
  realtimeType!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  symbol!: string | null;

  @Column({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;

  @Column({ type: 'text' })
  detail!: string;

  @Column({ name: 'parse_warnings', type: 'jsonb', nullable: true })
  parseWarnings!: string[] | null;
}
