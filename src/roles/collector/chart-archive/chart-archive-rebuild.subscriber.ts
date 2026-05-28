import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { REDIS_SUBSCRIBER, type RedisClientToken } from '@shared/cache/redis.module';
import { ChartArchiveWriterService } from './chart-archive-writer.service';

export const CHART_ARCHIVE_REBUILD_REQUEST_CHANNEL = 'chart_archive:rebuild_requested';

@Injectable()
export class ChartArchiveRebuildSubscriber implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ChartArchiveRebuildSubscriber.name);
  private listenerAttached = false;

  constructor(
    private readonly writer: ChartArchiveWriterService,
    @Optional() @Inject(REDIS_SUBSCRIBER) private readonly subscriber?: RedisClientToken,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.subscriber) {
      this.logger.warn('REDIS_SUBSCRIBER unavailable — chart archive rebuild request channel inactive');
      return;
    }
    if (!this.listenerAttached) {
      this.subscriber.on('message', (channel: string, raw: string) => {
        if (channel !== CHART_ARCHIVE_REBUILD_REQUEST_CHANNEL) return;
        this.handle(raw).catch((err) =>
          this.logger.warn(`chart archive rebuild request failed: ${err instanceof Error ? err.message : err}`),
        );
      });
      this.listenerAttached = true;
    }
    await this.subscriber.subscribe(CHART_ARCHIVE_REBUILD_REQUEST_CHANNEL);
    this.logger.log(`subscribed: ${CHART_ARCHIVE_REBUILD_REQUEST_CHANNEL}`);
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.subscriber) return;
    await this.subscriber.unsubscribe(CHART_ARCHIVE_REBUILD_REQUEST_CHANNEL).catch((err) => {
      this.logger.warn(`unsubscribe ${CHART_ARCHIVE_REBUILD_REQUEST_CHANNEL} failed: ${err instanceof Error ? err.message : err}`);
    });
  }

  private async handle(raw: string): Promise<void> {
    let limit = 100;
    try {
      const parsed = JSON.parse(raw) as { limit?: unknown };
      if (typeof parsed.limit === 'number' && Number.isFinite(parsed.limit)) {
        limit = Math.max(1, Math.min(1000, Math.floor(parsed.limit)));
      }
    } catch {
      // Keep the channel tolerant; old publishers may send an empty body.
    }
    const result = await this.writer.rebuildStaleDerivedManifests(limit);
    this.logger.log(`chart archive derived rebuild completed rebuilt=${result.rebuilt} skipped=${result.skipped}`);
  }
}
