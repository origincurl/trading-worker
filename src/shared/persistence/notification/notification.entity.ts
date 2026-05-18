import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EventCategory } from '@shared/model/notification/event-category.enum';
import { EventSeverity } from '@shared/model/notification/event-severity.enum';
import { NotificationRecordStatus } from '@shared/model/notification/notification-record-status.enum';
import { NotificationModel } from '@shared/model/notification/notification.model';

@Index('IDX_notification_user_id', ['userId'])
@Index('IDX_notification_account_id', ['accountId'])
@Index('IDX_notification_event_id', ['eventId'])
@Index('IDX_notification_created_at', ['createdAt'])
@Index('UQ_notification_event_user', ['eventId', 'userId'], { unique: true })
@Entity('notifications')
export class NotificationEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'event_id', type: 'bigint' })
  eventId!: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ name: 'account_id', type: 'bigint', nullable: true })
  accountId!: number | null;

  @Column({ type: 'enum', enum: EventCategory })
  category!: EventCategory;

  @Column({ type: 'enum', enum: EventSeverity })
  level!: EventSeverity;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'enum', enum: NotificationRecordStatus })
  status!: NotificationRecordStatus;

  @Column({ name: 'read_at', type: 'timestamp', nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  toModel(): NotificationModel {
    return Object.assign(new NotificationModel(), this);
  }
}
