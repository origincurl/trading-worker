import type { NotificationTemplateModel } from '@shared/model/notification-template/notification-template.model';

export interface NotificationTemplateRepository {
  findById(id: number): Promise<NotificationTemplateModel | null>;
  findActive(): Promise<NotificationTemplateModel[]>;
}
