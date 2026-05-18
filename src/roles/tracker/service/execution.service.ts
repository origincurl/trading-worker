import { Inject, Injectable, Logger } from '@nestjs/common';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { BUS_PUBLISHER, BUS_STREAMS } from '@shared/bus/bus.token';
import type { BusPublisher } from '@shared/bus/bus-publisher.interface';
import type { BusStreams } from '@shared/bus/bus-streams.interface';
import { WorkerEventFactory } from '@shared/event/event-factory';
import {
  ORDER_FILLED_EVENT_TYPE,
  ORDER_FILLED_SCHEMA_VERSION,
  ORDER_FILLED_STREAM,
  type OrderFilledPayload,
} from '@shared/event/order-filled.event';
import {
  ORDER_FILL_REPOSITORY,
  type OrderFillRepository,
} from '@shared/persistence/order-fill/order-fill.repository';

const ACCOUNT_FILL_EVENT_TYPE = 'account.fill';
const ACCOUNT_FILL_SCHEMA_VERSION = 1;

export interface IngestFillOutcome {
  readonly inserted: boolean;
}

// Single funnel for execution-stream fills: DB upsert dedup, account-scoped
// pubsub publish (architecture.md §6 — `account.{env}.fill.{accountId}`),
// and the canonical `order.filled` Streams event consumed by notifier and
// BE. Sinks are independent — a publisher hiccup must not block the DB
// row or the streams write.
@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);

  constructor(
    @Inject(ORDER_FILL_REPOSITORY) private readonly fillRepo: OrderFillRepository,
    @Inject(BUS_PUBLISHER) private readonly publisher: BusPublisher,
    @Inject(BUS_STREAMS) private readonly streams: BusStreams,
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
    private readonly eventFactory: WorkerEventFactory,
  ) {}

  async ingestFill(payload: OrderFilledPayload): Promise<IngestFillOutcome> {
    let outcome: 'inserted' | 'duplicate' = 'inserted';

    try {
      outcome = await this.fillRepo.upsertFill(payload);
    } catch (err) {
      this.logger.warn(
        `order_fill upsert failed (${payload.vendorOrderId}): ${err instanceof Error ? err.message : err}`,
      );
    }

    if (outcome === 'duplicate') {
      return { inserted: false };
    }

    await Promise.all([this.publishLiveFill(payload), this.produceFillStream(payload)]);

    return { inserted: true };
  }

  private async publishLiveFill(payload: OrderFilledPayload): Promise<void> {
    const channel = `account.${this.kiwoom.marketEnv}.fill.${payload.accountId}`;

    const event = this.eventFactory.build({
      eventType: ACCOUNT_FILL_EVENT_TYPE,
      schemaVersion: ACCOUNT_FILL_SCHEMA_VERSION,
      role: 'tracker',
      payload,
    });

    try {
      await this.publisher.publish(channel, event);
    } catch (err) {
      this.logger.warn(
        `account.fill publish failed channel=${channel}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private async produceFillStream(payload: OrderFilledPayload): Promise<void> {
    const event = this.eventFactory.build({
      eventType: ORDER_FILLED_EVENT_TYPE,
      schemaVersion: ORDER_FILLED_SCHEMA_VERSION,
      role: 'tracker',
      payload,
    });

    try {
      await this.streams.produce(ORDER_FILLED_STREAM, event);
    } catch (err) {
      this.logger.warn(
        `order.filled stream produce failed (${payload.vendorOrderId}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
