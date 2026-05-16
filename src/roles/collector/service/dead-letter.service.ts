import { Inject, Injectable, Logger } from '@nestjs/common';
import { RUNTIME_CONFIG, type RuntimeConfig } from '@config/runtime.config';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { BUS_STREAMS } from '@shared/bus/bus.token';
import type { BusStreams } from '@shared/bus/bus-streams.interface';
import {
  COLLECTOR_DEAD_LETTER_EVENT_TYPE,
  COLLECTOR_DEAD_LETTER_SCHEMA_VERSION,
  COLLECTOR_DEAD_LETTER_STREAM,
  type CollectorDeadLetterPayload,
  type CollectorDeadLetterReason,
} from '@shared/event/collector-dead-letter.event';
import { WorkerEventFactory } from '@shared/event/event-factory';
import {
  DEAD_LETTER_REPOSITORY,
  type DeadLetterRepository,
} from '../repository/dead-letter.repository';

interface ReasonCounter {
  total: number;
  byReason: Map<CollectorDeadLetterReason, number>;
}

// Routes parser dead-letters + candle-builder rejections into Streams +
// DB. Failures in either sink are logged but never thrown back so a
// monitoring outage cannot tear down the ingestion pipe.
@Injectable()
export class DeadLetterService {
  private readonly logger = new Logger(DeadLetterService.name);

  private readonly counter: ReasonCounter = { total: 0, byReason: new Map() };

  constructor(
    @Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig,
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
    @Inject(BUS_STREAMS) private readonly streams: BusStreams,
    @Inject(DEAD_LETTER_REPOSITORY) private readonly repo: DeadLetterRepository,
    private readonly eventFactory: WorkerEventFactory,
  ) {}

  total(): number {
    return this.counter.total;
  }

  byReason(): ReadonlyMap<CollectorDeadLetterReason, number> {
    return new Map(this.counter.byReason);
  }

  async emit(
    reason: CollectorDeadLetterReason,
    detail: string,
    ctx: {
      realtimeType: string | null;
      symbol: string | null;
      receivedAt?: Date;
      parseWarnings?: readonly string[];
    },
  ): Promise<void> {
    const payload: CollectorDeadLetterPayload = {
      provider: 'kiwoom',
      marketEnv: this.kiwoom.marketEnv,
      workerInstanceId: this.runtime.workerInstanceId,
      reason,
      realtimeType: ctx.realtimeType,
      symbol: ctx.symbol,
      receivedAt: (ctx.receivedAt ?? new Date()).toISOString(),
      detail,
      parseWarnings: ctx.parseWarnings,
    };

    this.counter.total += 1;

    this.counter.byReason.set(reason, (this.counter.byReason.get(reason) ?? 0) + 1);

    const event = this.eventFactory.build({
      eventType: COLLECTOR_DEAD_LETTER_EVENT_TYPE,
      schemaVersion: COLLECTOR_DEAD_LETTER_SCHEMA_VERSION,
      role: 'collector',
      payload,
    });

    // Streams + DB sinks in parallel; both are best-effort.
    await Promise.all([
      this.streams
        .produce(COLLECTOR_DEAD_LETTER_STREAM, event)
        .catch((err) =>
          this.logger.warn(
            `dead-letter stream produce failed: ${err instanceof Error ? err.message : err}`,
          ),
        ),
      this.repo
        .insert(payload)
        .catch((err) =>
          this.logger.warn(
            `dead-letter repo insert failed: ${err instanceof Error ? err.message : err}`,
          ),
        ),
    ]);
  }
}
