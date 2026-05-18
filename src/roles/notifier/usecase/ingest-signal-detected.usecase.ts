import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SignalDetectedJobPayload } from '@shared/event/signal-detected.event';
import {
  NOTIFICATION_OUTBOX_REPOSITORY,
  type NotificationOutboxRepository,
} from '@roles/notifier/repository/notification-outbox.repository';
import { EventChannelResolverService } from '@roles/notifier/service/event-channel-resolver.service';
import { EventRecordService } from '@roles/notifier/service/event-record.service';
import { NotifierStatusService } from '@roles/notifier/service/notifier-status.service';

// `signal.detected` reaches notifier via a Streams consumer (read-only;
// the BullMQ queue stays the executor's input). Phase 8 may replace this
// with a richer `decision-made` / `order-placed` / `order-failed` set.
const SOURCE_TYPE = 'account_strategy_event';
const EVENT_TYPE = 'signal.detected';
const DEFAULT_LEVEL = 'info';

@Injectable()
export class IngestSignalDetectedUsecase {
  private readonly logger = new Logger(IngestSignalDetectedUsecase.name);

  constructor(
    @Inject(NOTIFICATION_OUTBOX_REPOSITORY)
    private readonly outbox: NotificationOutboxRepository,
    private readonly eventRecord: EventRecordService,
    private readonly resolver: EventChannelResolverService,
    private readonly status: NotifierStatusService,
  ) {}

  async execute(input: {
    streamEntryId: string;
    payload: SignalDetectedJobPayload;
  }): Promise<void> {
    const occurredAt = new Date(input.payload.detectedAt);

    const { event, isNew } = await this.eventRecord.record({
      sourceType: SOURCE_TYPE,
      sourceId: this.sourceIdFromEntry(input.streamEntryId),
      eventType: EVENT_TYPE,
      level: DEFAULT_LEVEL,
      payload: input.payload as unknown as Record<string, unknown>,
      occurredAt,
    });

    if (!isNew) {
      this.logger.debug(
        `signal.detected duplicate suppressed (entry=${input.streamEntryId} signalId=${input.payload.signalId})`,
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
