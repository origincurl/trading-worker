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
import { ExecutionPersistenceService } from './execution-persistence.service';
import { AccountBalanceService } from './account-balance.service';
import { AccountPositionService } from './account-position.service';
import { TrackerTargetService } from './tracker-target.service';

const ACCOUNT_FILL_EVENT_TYPE = 'account.fill';
const ACCOUNT_FILL_SCHEMA_VERSION = 1;
const SNAPSHOT_REFRESH_DEBOUNCE_MS = readPositiveInt(
  process.env.TRACKER_ACCOUNT_SNAPSHOT_REFRESH_DEBOUNCE_MS,
  2000,
);

export interface IngestFillOutcome {
  readonly inserted: boolean;
  readonly anomaly: string | null;
}

export interface PublishOutboxOutcome {
  readonly attempted: number;
  readonly published: number;
  readonly failed: number;
}

// Single funnel for execution-stream fills: DB upsert dedup, account-scoped
// pubsub publish (architecture.md §6 — `account.{env}.fill.{accountId}`),
// and the canonical `order.filled` Streams event consumed by notifier and
// BE. Sinks are independent — a publisher hiccup must not block the DB
// row or the streams write.
@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);

  private readonly snapshotRefreshTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly persistence: ExecutionPersistenceService,
    private readonly targets: TrackerTargetService,
    private readonly balanceService: AccountBalanceService,
    private readonly positionService: AccountPositionService,
    @Inject(BUS_PUBLISHER) private readonly publisher: BusPublisher,
    @Inject(BUS_STREAMS) private readonly streams: BusStreams,
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
    private readonly eventFactory: WorkerEventFactory,
  ) {}

  async ingestFill(payload: OrderFilledPayload): Promise<IngestFillOutcome> {
    const outcome = await this.persistence.ingestExecutionFill(payload);

    if (!outcome.inserted) {
      if (!outcome.anomaly) return { inserted: false, anomaly: null };

      this.logger.warn(
        `order-fill skipped anomaly=${outcome.anomaly ?? 'duplicate'} orderId=${outcome.orderId ?? 'null'} accountExternalId=${payload.accountId} vendorOrderId=${payload.vendorOrderId} clientOrderId=${payload.clientOrderId}`,
      );

      return { inserted: false, anomaly: outcome.anomaly };
    }

    if (outcome.anomaly) {
      this.logger.warn(
        `order-fill ingested with anomaly=${outcome.anomaly} orderId=${outcome.orderId ?? 'null'} vendorOrderId=${payload.vendorOrderId}`,
      );
    }

    if (outcome.externalFillId) {
      await Promise.allSettled([
        this.publishLiveFill(payload, outcome.externalFillId),
        this.produceFillStream(payload, outcome.externalFillId),
      ]);
    }

    this.scheduleAccountSnapshotRefresh(payload.accountId);

    return { inserted: true, anomaly: outcome.anomaly };
  }

  async flushFillOutbox(limit: number): Promise<PublishOutboxOutcome> {
    const pending = await this.persistence.findPendingOutbox(limit);
    let published = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        if (item.needsLivePublish) {
          await this.publishLiveFill(item.payload, item.externalFillId);
        }
        if (item.needsStreamPublish) {
          await this.produceFillStream(item.payload, item.externalFillId);
        }
        await this.persistence.releaseOutboxClaim(item.externalFillId);
        published += 1;
      } catch {
        failed += 1;
      }
    }

    return { attempted: pending.length, published, failed };
  }

  pendingOutboxCount(): Promise<number> {
    return this.persistence.countPendingOutbox();
  }

  outboxPermanentFailureCount(): Promise<number> {
    return this.persistence.countOutboxPermanentFailures();
  }

  retryUnmatchedFills(limit: number) {
    return this.persistence.retryUnmatchedFills(limit);
  }

  countUnmatchedFills(status: 'PENDING' | 'DEAD_LETTER'): Promise<number> {
    return this.persistence.countUnmatched(status);
  }

  private async publishLiveFill(
    payload: OrderFilledPayload,
    externalFillId: string,
  ): Promise<void> {
    const channel = `account.${this.kiwoom.marketEnv}.fill.${payload.accountId}`;

    const event = this.eventFactory.build({
      eventType: ACCOUNT_FILL_EVENT_TYPE,
      schemaVersion: ACCOUNT_FILL_SCHEMA_VERSION,
      role: 'tracker',
      payload,
    });

    try {
      await this.publisher.publish(channel, event);
      await this.persistence.markOutboxPublished(externalFillId, 'live');
    } catch (err) {
      this.logger.warn(
        `account.fill publish failed channel=${channel}: ${err instanceof Error ? err.message : err}`,
      );
      await this.persistence.recordOutboxPublishFailure(externalFillId, err);
      throw err;
    }
  }

  private async produceFillStream(
    payload: OrderFilledPayload,
    externalFillId: string,
  ): Promise<void> {
    const event = this.eventFactory.build({
      eventType: ORDER_FILLED_EVENT_TYPE,
      schemaVersion: ORDER_FILLED_SCHEMA_VERSION,
      role: 'tracker',
      payload,
    });

    try {
      await this.streams.produce(ORDER_FILLED_STREAM, event);
      await this.persistence.markOutboxPublished(externalFillId, 'stream');
    } catch (err) {
      this.logger.warn(
        `order.filled stream produce failed (${payload.vendorOrderId}): ${err instanceof Error ? err.message : err}`,
      );
      await this.persistence.recordOutboxPublishFailure(externalFillId, err);
      throw err;
    }
  }

  private scheduleAccountSnapshotRefresh(accountExternalId: string): void {
    if (this.snapshotRefreshTimers.has(accountExternalId)) return;

    const timer = setTimeout(() => {
      this.snapshotRefreshTimers.delete(accountExternalId);

      this.refreshAccountSnapshot(accountExternalId).catch((err) =>
        this.logger.warn(
          `account snapshot refresh after fill failed account=${accountExternalId}: ${
            err instanceof Error ? err.message : err
          }`,
        ),
      );
    }, SNAPSHOT_REFRESH_DEBOUNCE_MS);

    this.snapshotRefreshTimers.set(accountExternalId, timer);
  }

  private async refreshAccountSnapshot(accountExternalId: string): Promise<void> {
    const target = await this.targets.findShardedTargetByExternalId(accountExternalId);

    if (!target) {
      this.logger.warn(`account snapshot refresh target not found account=${accountExternalId}`);

      return;
    }

    await Promise.allSettled([
      this.balanceService.syncOne(target),
      this.positionService.syncOne(target),
    ]);
  }
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
