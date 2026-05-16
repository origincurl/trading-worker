import { Inject, Injectable, Logger } from '@nestjs/common';
import { LatestPriceWriter } from '@shared/cache/latest-price.writer';
import { BUS_PUBLISHER } from '@shared/bus/bus.token';
import type { BusPublisher } from '@shared/bus/bus-publisher.interface';
import type { CollectorDeadLetterReason } from '@shared/event/collector-dead-letter.event';
import { WorkerEventFactory } from '@shared/event/event-factory';
import {
  MARKET_TICK_EVENT_TYPE,
  MARKET_TICK_SCHEMA_VERSION,
  marketTickChannel,
  type MarketTickPayload,
} from '@shared/event/market-tick.event';
import { CandleBuilderService } from './candle-builder.service';
import { CandleCloseService } from './candle-close.service';
import { DeadLetterService } from './dead-letter.service';
import type { TickRejectionCode } from './tick-rejection';

// Three sinks for one tick:
//   1. LatestPriceWriter — Redis hot path for BE snapshot reads
//   2. BusPublisher.publish(channel, event) — pubsub fan-out for BE WS gateway
//   3. CandleBuilder.ingest → if a bucket closed, CandleCloseService publishes
// Sinks 1+2 run regardless of rejection state (they reflect raw vendor
// data). Candle builder applies its own admission rules and may reject the
// tick without affecting the live fan-out.
@Injectable()
export class MarketTickService {
  private readonly logger = new Logger(MarketTickService.name);

  private _lastTickAt: Date | null = null;

  private _tickCount = 0;

  constructor(
    private readonly latestPriceWriter: LatestPriceWriter,
    private readonly eventFactory: WorkerEventFactory,
    @Inject(BUS_PUBLISHER) private readonly busPublisher: BusPublisher,
    private readonly candleBuilder: CandleBuilderService,
    private readonly candleClose: CandleCloseService,
    private readonly deadLetter: DeadLetterService,
  ) {}

  lastTickAt(): Date | null {
    return this._lastTickAt;
  }

  tickCount(): number {
    return this._tickCount;
  }

  async recordTick(payload: MarketTickPayload): Promise<void> {
    this._lastTickAt = new Date();

    this._tickCount += 1;

    const channel = marketTickChannel(payload.provider, payload.marketEnv, payload.symbol);

    const event = this.eventFactory.build({
      eventType: MARKET_TICK_EVENT_TYPE,
      schemaVersion: MARKET_TICK_SCHEMA_VERSION,
      role: 'collector',
      payload,
    });

    // Live fan-out (independent of candle admission).
    const fanout = Promise.all([
      this.latestPriceWriter
        .write(payload.provider, payload.symbol, payload)
        .catch((err) =>
          this.logger.warn(`LatestPriceWriter.write failed (${payload.symbol}): ${errMsg(err)}`),
        ),
      this.busPublisher
        .publish(channel, event)
        .catch((err) =>
          this.logger.warn(`BusPublisher.publish failed (${channel}): ${errMsg(err)}`),
        ),
    ]);

    // Candle ingest + close emission. Failures here MUST NOT propagate
    // back into fan-out — they affect persistence, not live display.
    const ingest = this.candleBuilder.ingest(payload);

    if (ingest.kind === 'accepted' && ingest.closed) {
      await this.candleClose.close(ingest.closed, 'realtime');
    } else if (ingest.kind === 'rejected') {
      await this.deadLetter
        .emit(rejectionToDeadLetterReason(ingest.reason), ingest.detail, {
          realtimeType: '0B',
          symbol: payload.symbol,
          receivedAt: new Date(payload.receivedAt),
          parseWarnings: payload.parseWarnings,
        })
        .catch((err) => this.logger.warn(`dead-letter emit failed: ${errMsg(err)}`));
    }

    await fanout;
  }
}

function rejectionToDeadLetterReason(code: TickRejectionCode): CollectorDeadLetterReason {
  switch (code) {
    case 'parse-warning':
      return 'parse-warning';

    case 'missing-required-field':
      return 'missing-required-field';

    case 'invalid-price':
      return 'invalid-price';

    case 'invalid-volume':
      return 'invalid-volume';

    case 'stale-tick':
      return 'stale-tick';
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
