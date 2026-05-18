import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { REDIS_CLIENT, type RedisClientToken } from '@shared/cache/redis.module';
import {
  ChartCatchupService,
  type ChartCatchupRequest,
  type ChartCatchupResult,
} from '@roles/collector/service/chart-catchup.service';

// Redis pub channel BE listens on for completion notifications. Optional —
// publish failures are logged but never crash the worker.
const COMPLETION_CHANNEL_PREFIX = 'chart:catchup:completed:';

// Phase E: drives one catchup request through ChartCatchupService and
// reports completion back on a per-request redis channel. Called from
// the BullMQ consumer (chart-catchup.consumer.ts) — Redis pubsub
// triggers it via the subscriber, which enqueues into BullMQ.
@Injectable()
export class ProcessChartCatchupUsecase {
  private readonly logger = new Logger(ProcessChartCatchupUsecase.name);

  constructor(
    private readonly service: ChartCatchupService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: RedisClientToken,
  ) {}

  async execute(request: ChartCatchupRequest): Promise<ChartCatchupResult> {
    const startedAt = new Date();
    const result = await this.service.run(request);

    this.logger.log(
      `catchup request=${request.requestId} symbol=${request.symbol} written=${result.candlesWritten} skipped=${result.candlesSkipped} errors=${result.errors.length}`,
    );

    await this.publishCompletion(request, result, startedAt).catch((err) =>
      this.logger.warn(
        `catchup completion publish failed: ${err instanceof Error ? err.message : err}`,
      ),
    );

    return result;
  }

  private async publishCompletion(
    request: ChartCatchupRequest,
    result: ChartCatchupResult,
    startedAt: Date,
  ): Promise<void> {
    if (!this.redis) return;

    const channel = `${COMPLETION_CHANNEL_PREFIX}${request.requestId}`;
    const message = JSON.stringify({
      requestId: request.requestId,
      symbol: request.symbol,
      intervalType: request.intervalType,
      fromIso: request.fromIso,
      toIso: request.toIso,
      candlesWritten: result.candlesWritten,
      candlesSkipped: result.candlesSkipped,
      errors: result.errors,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
    });

    await this.redis.publish(channel, message);
  }
}
