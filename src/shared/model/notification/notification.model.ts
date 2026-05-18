import { EventCategory } from './event-category.enum';
import { EventSeverity } from './event-severity.enum';
import { NotificationRecordStatus } from './notification-record-status.enum';

export class NotificationModel {
  id!: number;
  eventId!: number;
  userId!: number;
  accountId!: number | null;
  category!: EventCategory;
  level!: EventSeverity;
  title!: string;
  body!: string;
  status!: NotificationRecordStatus;
  readAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}
