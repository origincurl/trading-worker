import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// Immutable audit row written once per dispatch attempt. The outbox row is
// the working set; this table is the history. /admin and BE queries can
// join by outbox_id to render delivery timelines.
@Entity({ name: 'notification_deliveries' })
@Index('ix_notification_deliveries_outbox', ['outboxId'])
@Index('ix_notification_deliveries_sent_at', ['sentAt'])
export class NotificationDeliveryEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'outbox_id', type: 'bigint' })
  outboxId!: string;

  @Column({ name: 'channel_id', type: 'bigint' })
  channelId!: string;

  @Column({ name: 'channel_type', type: 'varchar', length: 16 })
  channelType!: string;

  @Column({ type: 'varchar', length: 16 })
  status!: 'delivered' | 'skipped' | 'failed';

  @Column({ name: 'sent_at', type: 'timestamptz' })
  sentAt!: Date;

  @Column({ name: 'response_payload', type: 'jsonb', nullable: true })
  responsePayload!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
