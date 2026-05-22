import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { REDIS_SUBSCRIBER, type RedisClientToken } from '@shared/cache/redis.module';
import { RefreshUniverseUsecase } from '@roles/collector/usecase/refresh-universe.usecase';

const UNIVERSE_REFRESH_HINT_CHANNEL = 'universe:refresh:hint';
const DEBOUNCE_MS = 500;

@Injectable()
export class UniverseRefreshHintSubscriber implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(UniverseRefreshHintSubscriber.name);

  private listenerAttached = false;

  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Optional() @Inject(REDIS_SUBSCRIBER) private readonly subscriber: RedisClientToken,
    private readonly refreshUniverse: RefreshUniverseUsecase,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.subscriber) {
      this.logger.warn('REDIS_SUBSCRIBER unavailable — universe refresh hint inactive');

      return;
    }

    if (!this.listenerAttached) {
      this.subscriber.on('message', (channel: string) => {
        if (channel !== UNIVERSE_REFRESH_HINT_CHANNEL) return;
        this.scheduleRefresh();
      });

      this.listenerAttached = true;
    }

    await this.subscriber.subscribe(UNIVERSE_REFRESH_HINT_CHANNEL);
    this.logger.log(`subscribed: ${UNIVERSE_REFRESH_HINT_CHANNEL}`);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    if (!this.subscriber) return;

    try {
      await this.subscriber.unsubscribe(UNIVERSE_REFRESH_HINT_CHANNEL);
    } catch (err) {
      this.logger.warn(
        `unsubscribe ${UNIVERSE_REFRESH_HINT_CHANNEL} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private scheduleRefresh(): void {
    this.refreshUniverse.recordHintReceived();

    if (this.timer) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      this.refreshUniverse.execute().catch((err) =>
        this.logger.warn(`universe hint refresh failed: ${err instanceof Error ? err.message : err}`),
      );
    }, DEBOUNCE_MS);
  }
}
