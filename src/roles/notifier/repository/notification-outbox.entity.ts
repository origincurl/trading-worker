import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '@shared/persistence/base.entity';

export type NotificationOutboxStatus = 'PENDING' | 'SENT' | 'FAILED';

// One row per (event, channel) pair. notification-outbox.scheduler claims
// PENDING rows whose next_attempt_at has elapsed, calls NotifyVendor, then
// marks the row SENT or FAILED with exponential backoff. Index keeps the
// claim query selective.
@Entity({ name: 'notification_outbox' })
@Index('ix_notification_outbox_status_next_attempt', ['status', 'nextAttemptAt'])
@Index('ix_notification_outbox_event', ['eventId'])
export class NotificationOutboxEntity extends BaseEntity {
  @Column({ name: 'event_id', type: 'bigint' })
  eventId!: string;

  @Column({ name: 'channel_id', type: 'bigint' })
  channelId!: string;

  @Column({ name: 'channel_type', type: 'varchar', length: 16 })
  channelType!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 16 })
  status!: NotificationOutboxStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  nextAttemptAt!: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;
}
