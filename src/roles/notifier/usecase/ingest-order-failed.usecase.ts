import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ORDER_FAILED_STREAM,
  type OrderFailedPayload,
} from '@shared/event/order-failed.event';
import {
  NOTIFICATION_OUTBOX_REPOSITORY,
  type NotificationOutboxRepository,
} from '@roles/notifier/repository/notification-outbox.repository';
import { EventChannelResolverService } from '@roles/notifier/service/event-channel-resolver.service';
import { EventRecordService } from '@roles/notifier/service/event-record.service';
import { resolveEventType } from '@roles/notifier/service/event-type.map';
import { NotifierStatusService } from '@roles/notifier/service/notifier-status.service';

@Injectable()
export class IngestOrderFailedUsecase {
  private readonly logger = new Logger(IngestOrderFailedUsecase.name);

  constructor(
    @Inject(NOTIFICATION_OUTBOX_REPOSITORY)
    private readonly outbox: NotificationOutboxRepository,
    private readonly eventRecord: EventRecordService,
    private readonly resolver: EventChannelResolverService,
    private readonly status: NotifierStatusService,
  ) {}

  async execute(input: {
    streamEntryId: string;
    payload: OrderFailedPayload;
  }): Promise<void> {
    const occurredAt = new Date(input.payload.failedAt);
    const resolved = resolveEventType(ORDER_FAILED_STREAM, input.payload);

    const { event, isNew } = await this.eventRecord.record({
      sourceType: resolved.sourceType,
      sourceId: this.sourceIdFromEntry(input.streamEntryId),
      eventType: resolved.eventType,
      level: resolved.level,
      payload: input.payload as unknown as Record<string, unknown>,
      occurredAt,
    });

    if (!isNew) {
      this.logger.debug(
        `order.failed duplicate suppressed (entry=${input.streamEntryId} clientOrderId=${input.payload.clientOrderId ?? 'n/a'})`,
      );

      return;
    }

    this.status.recordIngest();

    const candidates = await this.resolver.resolve(resolved.sourceType, 0);

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
