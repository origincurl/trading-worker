export interface NotificationDeliveryInput {
  readonly outboxId: string;
  readonly channelId: string;
  readonly channelType: string;
  readonly status: 'delivered' | 'skipped' | 'failed';
  readonly sentAt: Date;
  readonly responsePayload: Record<string, unknown> | null;
}

export interface NotificationDeliveryRepository {
  insert(input: NotificationDeliveryInput): Promise<void>;
}

export const NOTIFICATION_DELIVERY_REPOSITORY = Symbol('NOTIFICATION_DELIVERY_REPOSITORY');
