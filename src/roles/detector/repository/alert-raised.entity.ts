import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '@shared/persistence/base.entity';

@Entity({ name: 'alert_raised' })
@Unique('uq_alert_raised_alert_id', ['alertId'])
@Index('ix_alert_raised_category_raised_at', ['category', 'raisedAt'])
export class AlertRaisedEntity extends BaseEntity {
  @Column({ name: 'alert_id', type: 'varchar', length: 64 })
  alertId!: string;

  @Column({ type: 'varchar', length: 64 })
  category!: string;

  @Column({ type: 'varchar', length: 16 })
  severity!: string;

  @Column({ type: 'varchar', length: 256 })
  subject!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, string> | null;

  @Column({ name: 'raised_at', type: 'timestamptz' })
  raisedAt!: Date;

  @Column({ name: 'worker_instance_id', type: 'varchar', length: 128 })
  workerInstanceId!: string;
}
