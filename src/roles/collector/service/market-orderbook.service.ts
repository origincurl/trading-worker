import { Inject, Injectable, Logger } from '@nestjs/common';
import { BUS_PUBLISHER } from '@shared/bus/bus.token';
import type { BusPublisher } from '@shared/bus/bus-publisher.interface';
import { WorkerEventFactory } from '@shared/event/event-factory';
import {
  MARKET_ORDERBOOK_EVENT_TYPE,
  MARKET_ORDERBOOK_SCHEMA_VERSION,
  marketOrderbookChannel,
  type MarketOrderbookPayload,
} from '@shared/event/market-orderbook.event';

// architecture.md §8: orderbook is volatile fan-out only (pubsub).
// No DB persistence, no Streams — high frequency, FE re-pulls on
// reconnect. Throttle/coalesce is BE-side concern.
@Injectable()
export class MarketOrderbookService {
  private readonly logger = new Logger(MarketOrderbookService.name);

  private _lastSnapshotAt: Date | null = null;

  private _snapshotCount = 0;

  constructor(
    private readonly eventFactory: WorkerEventFactory,
    @Inject(BUS_PUBLISHER) private readonly busPublisher: BusPublisher,
  ) {}

  lastSnapshotAt(): Date | null {
    return this._lastSnapshotAt;
  }

  snapshotCount(): number {
    return this._snapshotCount;
  }

  async recordSnapshot(payload: MarketOrderbookPayload): Promise<void> {
    this._lastSnapshotAt = new Date();

    this._snapshotCount += 1;

    const channel = marketOrderbookChannel(payload.provider, payload.marketEnv, payload.symbol);

    const event = this.eventFactory.build({
      eventType: MARKET_ORDERBOOK_EVENT_TYPE,
      schemaVersion: MARKET_ORDERBOOK_SCHEMA_VERSION,
      role: 'collector',
      payload,
    });

    await this.busPublisher
      .publish(channel, event)
      .catch((err) =>
        this.logger.warn(
          `BusPublisher.publish failed (${channel}): ${err instanceof Error ? err.message : err}`,
        ),
      );
  }
}
