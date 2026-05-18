import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ALERT_RAISED_EVENT_TYPE,
  type AlertRaisedPayload,
} from '@shared/event/alert-raised.event';
import {
  NOTIFICATION_OUTBOX_REPOSITORY,
  type NotificationOutboxRepository,
} from '@roles/notifier/repository/notification-outbox.repository';
import { EventChannelResolverService } from '@roles/notifier/service/event-channel-resolver.service';
import { EventRecordService } from '@roles/notifier/service/event-record.service';
import { NotifierStatusService } from '@roles/notifier/service/notifier-status.service';

const SOURCE_TYPE = 'account_risk_event';

@Injectable()
export class IngestAlertRaisedUsecase {
  private readonly logger = new Logger(IngestAlertRaisedUsecase.name);

  constructor(
    @Inject(NOTIFICATION_OUTBOX_REPOSITORY)
    private readonly outbox: NotificationOutboxRepository,
    private readonly eventRecord: EventRecordService,
    private readonly resolver: EventChannelResolverService,
    private readonly status: NotifierStatusService,
  ) {}

  async execute(input: {
    streamEntryId: string;
    payload: AlertRaisedPayload;
  }): Promise<void> {
    const occurredAt = new Date(input.payload.raisedAt);

    // alertId is a ulid — fits comfortably as the dedup key once the bigint
    // sourceId column accepts strings via TypeORM coercion. We hash to a
    // numeric-string by lowercase comparison instead: keep the stream entry
    // id as sourceId for consistency with the other ingesters until BE PK
    // lookup ships.
    const { event, isNew } = await this.eventRecord.record({
      sourceType: SOURCE_TYPE,
      sourceId: this.sourceIdFromEntry(input.streamEntryId),
      eventType: ALERT_RAISED_EVENT_TYPE,
      level: input.payload.severity,
      payload: input.payload as unknown as Record<string, unknown>,
      occurredAt,
    });

    if (!isNew) {
      this.logger.debug(
        `alert.raised duplicate suppressed (entry=${input.streamEntryId} alertId=${input.payload.alertId})`,
      );

      return;
    }

    this.status.recordIngest();

    const candidates = await this.resolver.resolve(SOURCE_TYPE, 0);

    if (candidates.length > 0) {
      const now = new Date();

      await this.outbox.insertMany(
        candidates.map((c) => ({
          eventId: event.id,
          channelId: String(c.channelId),
          channelType: c.channelType,
          payload: event.payload,
          nextAttemptAt: now,
        })),
      );

      this.status.recordOutboxRows(candidates.length);
    }

    await this.eventRecord.markProcessed(event.id, new Date());
  }

  private sourceIdFromEntry(entryId: string): string | null {
    const head = entryId.split('-')[0];

    return head && /^\d+$/.test(head) ? head : null;
  }
}
