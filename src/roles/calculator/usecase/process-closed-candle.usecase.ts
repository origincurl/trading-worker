import { Inject, Injectable, Logger } from '@nestjs/common';
import { BUS_PUBLISHER } from '@shared/bus/bus.token';
import type { BusPublisher } from '@shared/bus/bus-publisher.interface';
import { WorkerEventFactory } from '@shared/event/event-factory';
import type { MarketCandleClosedPayload } from '@shared/event/market-candle-closed.event';
import {
  INDICATOR_UPDATED_EVENT_TYPE,
  INDICATOR_UPDATED_SCHEMA_VERSION,
  indicatorChannel,
  type IndicatorUpdatedPayload,
} from '@shared/event/indicator-updated.event';
import {
  INDICATOR_REPOSITORY,
  type IndicatorRepository,
} from '@roles/calculator/repository/indicator.repository';
import { IndicatorService } from '@roles/calculator/service/indicator.service';

@Injectable()
export class ProcessClosedCandleUsecase {
  private readonly logger = new Logger(ProcessClosedCandleUsecase.name);

  private _processedCount = 0;

  private _lastProcessedAt: Date | null = null;

  constructor(
    private readonly indicatorService: IndicatorService,
    private readonly eventFactory: WorkerEventFactory,
    @Inject(INDICATOR_REPOSITORY) private readonly repo: IndicatorRepository,
    @Inject(BUS_PUBLISHER) private readonly busPublisher: BusPublisher,
  ) {}

  processedCount(): number {
    return this._processedCount;
  }

  lastProcessedAt(): Date | null {
    return this._lastProcessedAt;
  }

  async execute(candle: MarketCandleClosedPayload): Promise<void> {
    const updates = this.indicatorService.update(candle.symbol, candle.marketEnv, candle.close);

    const computedAt = new Date().toISOString();

    for (const u of updates) {
      const payload: IndicatorUpdatedPayload = {
        provider: candle.provider,
        marketEnv: candle.marketEnv,
        symbol: candle.symbol,
        intervalType: '1m',
        bucketStart: candle.bucketStart,
        indicatorType: u.indicatorType,
        windowSize: u.windowSize,
        value: u.value,
        computedAt,
      };

      // DB write first — it is the authoritative source. Publish failure
      // is recoverable (subscribers can replay via DB scan); a missed
      // upsert is not.
      try {
        await this.repo.upsert(payload);
      } catch (err) {
        this.logger.warn(
          `indicator upsert failed (${payload.symbol}/${payload.indicatorType}${payload.windowSize}): ${
            err instanceof Error ? err.message : err
          }`,
        );
      }

      const event = this.eventFactory.build({
        eventType: INDICATOR_UPDATED_EVENT_TYPE,
        schemaVersion: INDICATOR_UPDATED_SCHEMA_VERSION,
        role: 'calculator',
        payload,
      });

      const channel = indicatorChannel(
        payload.provider,
        payload.marketEnv,
        payload.symbol,
        payload.indicatorType,
        payload.windowSize,
      );

      await this.busPublisher
        .publish(channel, event)
        .catch((err) =>
          this.logger.warn(
            `indicator publish failed (${channel}): ${err instanceof Error ? err.message : err}`,
          ),
        );
    }

    this._processedCount += 1;

    this._lastProcessedAt = new Date();
  }
}
