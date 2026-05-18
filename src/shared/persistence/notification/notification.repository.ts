import type { EventCategory } from '@shared/model/notification/event-category.enum';
import type { EventSeverity } from '@shared/model/notification/event-severity.enum';
import type { NotificationRecordStatus } from '@shared/model/notification/notification-record-status.enum';
import type { NotificationModel } from '@shared/model/notification/notification.model';

export interface CreateNotificationInput {
  readonly eventId: number;
  readonly userId: number;
  readonly accountId: number | null;
  readonly category: EventCategory;
  readonly level: EventSeverity;
  readonly title: string;
  readonly body: string;
  readonly status: NotificationRecordStatus;
}

export interface NotificationRepository {
  createNotification(input: CreateNotificationInput): Promise<NotificationModel>;
  // Returns true when a row was updated. userId guard prevents one
  // user from marking another user's notifications as read.
  markRead(id: number, userId: number): Promise<boolean>;
}
