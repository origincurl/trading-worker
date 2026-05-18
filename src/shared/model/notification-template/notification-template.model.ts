import { NotificationType } from '@shared/model/notification/notification-type.enum';

export class NotificationTemplateModel {
  id!: number;
  userId!: number | null;
  name!: string;
  templateType!: NotificationType;
  titleTemplate!: string | null;
  bodyTemplate!: string;
  metadata!: Record<string, unknown> | null;
  isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;
}
