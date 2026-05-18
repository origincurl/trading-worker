import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NotificationType } from '@shared/model/notification/notification-type.enum';
import { NotificationTemplateModel } from '@shared/model/notification-template/notification-template.model';

@Index('IDX_notification_template_user_id', ['userId'])
@Entity('notification_templates')
export class NotificationTemplateEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: number;

  @Column({ name: 'user_id', type: 'bigint', nullable: true })
  userId!: number | null;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'template_type', type: 'enum', enum: NotificationType })
  templateType!: NotificationType;

  @Column({ name: 'title_template', type: 'varchar', length: 255, nullable: true })
  titleTemplate!: string | null;

  @Column({ name: 'body_template', type: 'text' })
  bodyTemplate!: string;

  @Column({ type: 'json', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ name: 'is_active', type: 'boolean' })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  toModel(): NotificationTemplateModel {
    return Object.assign(new NotificationTemplateModel(), this);
  }
}
