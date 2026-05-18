import type { NotificationOutboxStatus } from './notification-outbox.entity';

export interface NotificationOutboxInsertInput {
  readonly eventId: string;
  readonly channelId: string;
  readonly channelType: string;
  readonly payload: Record<string, unknown>;
  readonly nextAttemptAt: Date;
}

export interface NotificationOutboxRow {
  readonly id: string;
  readonly eventId: string;
  readonly channelId: string;
  readonly channelType: string;
  readonly payload: Record<string, unknown>;
  readonly status: NotificationOutboxStatus;
  readonly attempts: number;
  readonly nextAttemptAt: Date;
}

export interface NotificationOutboxRepository {
  insertMany(rows: readonly NotificationOutboxInsertInput[]): Promise<void>;
  claimPending(limit: number, now: Date): Promise<NotificationOutboxRow[]>;
  markSent(id: string, sentAt: Date): Promise<void>;
  markFailed(id: string, error: string, nextAttemptAt: Date | null): Promise<void>;
}

export const NOTIFICATION_OUTBOX_REPOSITORY = Symbol('NOTIFICATION_OUTBOX_REPOSITORY');
