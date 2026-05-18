import { Inject, Injectable, Logger } from '@nestjs/common';
import { NOTIFIER_CONFIG, type NotifierConfig } from '@config/notifier.config';
import type { NotifyChannelType } from '@external/notify/notify.token';
import { SettingLevel } from '@shared/model/notification/setting-level.enum';
import type { EventChannelCandidate } from '@roles/notifier/service/event-channel-resolver.service';
import {
  NOTIFICATION_DELIVERY_REPOSITORY,
  type NotificationDeliveryRepository,
} from '@roles/notifier/repository/notification-delivery.repository';
import {
  NOTIFICATION_OUTBOX_REPOSITORY,
  type NotificationOutboxRepository,
  type NotificationOutboxRow,
} from '@roles/notifier/repository/notification-outbox.repository';
import { NotificationDispatchService } from '@roles/notifier/service/notification-dispatch.service';
import {
  NotificationFormatterService,
  type FormattedNotification,
} from '@roles/notifier/service/notification-formatter.service';
import { NotifierStatusService } from '@roles/notifier/service/notifier-status.service';

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

@Injectable()
export class DispatchNotificationOutboxUsecase {
  private readonly logger = new Logger(DispatchNotificationOutboxUsecase.name);

  constructor(
    @Inject(NOTIFIER_CONFIG) private readonly config: NotifierConfig,
    @Inject(NOTIFICATION_OUTBOX_REPOSITORY)
    private readonly outbox: NotificationOutboxRepository,
    @Inject(NOTIFICATION_DELIVERY_REPOSITORY)
    private readonly deliveries: NotificationDeliveryRepository,
    private readonly formatter: NotificationFormatterService,
    private readonly dispatcher: NotificationDispatchService,
    private readonly status: NotifierStatusService,
  ) {}

  async execute(): Promise<void> {
    const now = new Date();
    const claimed = await this.outbox.claimPending(this.config.outboxBatchSize, now);

    if (claimed.length === 0) return;

    for (const row of claimed) {
      await this.handleRow(row);
    }
  }

  private async handleRow(row: NotificationOutboxRow): Promise<void> {
    const formatted = await this.formatPayload(row);

    try {
      const result = await this.dispatcher.dispatch({
        channelType: row.channelType,
        // payload mirrors the original event; channel-side config is
        // intentionally empty until BE resolution returns real metadata.
        channelConfig: {},
        title: formatted.title,
        body: formatted.body,
        level: 'info',
      });

      const sentAt = new Date();

      await this.deliveries.insert({
        outboxId: row.id,
        channelId: row.channelId,
        channelType: row.channelType,
        status: result.status,
        sentAt,
        responsePayload: result.reason ? { reason: result.reason, vendor: result.vendor } : null,
      });

      if (result.status === 'failed') {
        const nextAttempt = this.nextAttemptDate(row.attempts + 1);

        await this.outbox.markFailed(row.id, result.reason ?? 'unknown vendor failure', nextAttempt);
        this.status.recordDispatch('failed');
      } else {
        await this.outbox.markSent(row.id, sentAt);
        this.status.recordDispatch('ok');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const nextAttempt = this.nextAttemptDate(row.attempts + 1);

      this.logger.warn(
        `outbox dispatch threw (outbox=${row.id} channel=${row.channelType}): ${message}`,
      );

      await this.outbox.markFailed(row.id, message, nextAttempt);
      this.status.recordDispatch('failed');
    }
  }

  // attempt is 1-based (next attempt count after the current one).
  // Returns null when max-attempts has been reached → outbox row is
  // permanently FAILED and won't be re-claimed.
  private nextAttemptDate(attemptCount: number): Date | null {
    if (attemptCount >= this.config.outboxMaxAttempts) return null;

    const delay = Math.min(BASE_BACKOFF_MS * 2 ** (attemptCount - 1), MAX_BACKOFF_MS);

    return new Date(Date.now() + delay);
  }

  private async formatPayload(row: NotificationOutboxRow): Promise<FormattedNotification> {
    // No richer candidate context here yet — fall back to a synthetic one
    // with templateId=null so the formatter renders the default body.
    const stubCandidate: EventChannelCandidate = {
      eventChannelId: 0,
      channelId: Number(row.channelId),
      channelType: row.channelType as NotifyChannelType,
      channelConfig: {},
      level: SettingLevel.Info,
      templateId: null,
    };

    return this.formatter.format(
      {
        id: row.eventId,
        sourceType: 'unknown',
        sourceId: null,
        eventType: 'unknown',
        level: 'info',
        payload: row.payload,
        occurredAt: new Date(),
      },
      row.payload,
      stubCandidate,
    );
  }
}
