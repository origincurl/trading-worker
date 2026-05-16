import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { CandleBuilderService } from '@roles/collector/service/candle-builder.service';
import { CandleCloseService } from '@roles/collector/service/candle-close.service';

// SIGTERM drain. Phase 6.6 closes buckets only when a later-bucket tick
// arrives — at process shutdown, open buckets would vanish silently. This
// hook flushes every in-flight bucket so the last partial minute is at
// least persisted. EOD-time-of-day flush is out of Phase 6.6 scope (a
// future phase may add a scheduler that fires at KST market close).
@Injectable()
export class CandleFlushScheduler implements OnApplicationShutdown {
  private readonly logger = new Logger(CandleFlushScheduler.name);

  constructor(
    private readonly builder: CandleBuilderService,
    private readonly closeSvc: CandleCloseService,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    const open = this.builder.flushAll();

    if (open.length === 0) return;

    this.logger.log(`flushing ${open.length} open candles on shutdown`);

    for (const candle of open) {
      try {
        await this.closeSvc.close(candle, 'realtime');
      } catch (err) {
        this.logger.warn(
          `flush close failed (${candle.symbol}@${candle.bucketStart.toISOString()}): ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
  }
}
