import { Inject, Injectable, Logger } from '@nestjs/common';
import { NOTIFIER_CONFIG, type NotifierConfig } from '@config/notifier.config';
import type { OrderFilledPayload } from '@shared/event/order-filled.event';
import { ORDER_FILLED_EVENT_TYPE } from '@shared/event/order-filled.event';
import {
  NOTIFICATION_OUTBOX_REPOSITORY,
  type NotificationOutboxRepository,
} from '@roles/notifier/repository/notification-outbox.repository';
import { EventChannelResolverService } from '@roles/notifier/service/event-channel-resolver.service';
import { EventRecordService } from '@roles/notifier/service/event-record.service';
import { NotifierStatusService } from '@roles/notifier/service/notifier-status.service';

const SOURCE_TYPE = 'order_fill';
const DEFAULT_LEVEL = 'info';

@Injectable()
export class IngestOrderFilledUsecase {
  private readonly logger = new Logger(IngestOrderFilledUsecase.name);

  constructor(
    @Inject(NOTIFIER_CONFIG) private readonly config: NotifierConfig,
    @Inject(NOTIFICATION_OUTBOX_REPOSITORY)
    private readonly outbox: NotificationOutboxRepository,
    private readonly eventRecord: EventRecordService,
    private readonly resolver: EventChannelResolverService,
    private readonly status: NotifierStatusService,
  ) {
    void this.config;
  }

  async execute(input: {
    streamEntryId: string;
    payload: OrderFilledPayload;
  }): Promise<void> {
    const occurredAt = new Date(input.payload.filledAt);

    // sourceId: we don't have an internal order_fill PK in the worker yet
    // (BE owns it). Use the stream entry id so re-replay is idempotent on
    // (sourceType, sourceId, eventType). The TODO above EventRecordService
    // tracks swapping this to the internal PK once BE lookup ships.
    const { event, isNew } = await this.eventRecord.record({
      sourceType: SOURCE_TYPE,
      sourceId: this.sourceIdFromEntry(input.streamEntryId),
      eventType: ORDER_FILLED_EVENT_TYPE,
      level: DEFAULT_LEVEL,
      payload: input.payload as unknown as Record<string, unknown>,
      occurredAt,
    });

    if (!isNew) {
      this.logger.debug(
        `order.filled duplicate suppressed (entry=${input.streamEntryId} vendorOrderId=${input.payload.vendorOrderId})`,
      );

      return;
    }

    this.status.recordIngest();

    await this.fanoutToOutbox(event.id, SOURCE_TYPE, event.payload);

    await this.eventRecord.markProcessed(event.id, new Date());
  }

  private sourceIdFromEntry(entryId: string): string | null {
    // Redis stream IDs are `<ms>-<seq>`. Take the ms half for the bigint
    // column — enough uniqueness when combined with sourceType+eventType.
    const head = entryId.split('-')[0];

    return head && /^\d+$/.test(head) ? head : null;
  }

  private async fanoutToOutbox(
    eventId: string,
    sourceType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // sourceEventId: pass 0 sentinel; resolver short-circuits until
    // EventRecordService resolves the internal account_strategy_event_id
    // (TODO in event-record.service.ts).
    const candidates = await this.resolver.resolve(sourceType, 0);

    if (candidates.length === 0) return;

    const now = new Date();

    await this.outbox.insertMany(
      candidates.map((c) => ({
        eventId,
        channelId: String(c.channelId),
        channelType: c.channelType,
        payload,
        nextAttemptAt: now,
      })),
    );

    this.status.recordOutboxRows(candidates.length);
  }
}
