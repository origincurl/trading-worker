import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { REDIS_CONFIG, type RedisConfig } from '@config/redis.config';
import { safeStringify } from '@common/util/safe-stringify';
import { marketIndexChannel, type MarketIndexPayload } from '@shared/event/market-index.event';
import { REDIS_CLIENT, type RedisClientToken } from './redis.tokens';

const NAMESPACE = 'market';

export type MarketIndexSnapshotCacheEntry = {
  payload: MarketIndexPayload;
  cachedAt: string;
  source: 'rest_ka20001' | 'ws_0J';
};

export type FxRateCacheEntry = {
  pair: string;
  base: string;
  quote: string;
  rate: number;
  change: number | null;
  changePct: number | null;
  fetchedAt: string;
  source: 'moneyconvert';
};

@Injectable()
export class MarketSnapshotWriter {
  private readonly logger = new Logger(MarketSnapshotWriter.name);

  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly client: RedisClientToken,
    @Inject(REDIS_CONFIG) private readonly redis: RedisConfig,
  ) {}

  async writeIndex(entry: MarketIndexSnapshotCacheEntry): Promise<void> {
    if (!this.client) {
      this.logger.debug('Redis disabled, skipping market index snapshot write');

      return;
    }

    const key = `${NAMESPACE}:v1:index:latest:${entry.payload.provider}:${entry.payload.marketEnv}:${entry.payload.symbol}`;
    const channel = marketIndexChannel(entry.payload.provider, entry.payload.marketEnv, entry.payload.symbol);
    const serialized = safeStringify(entry);

    await this.client.set(key, serialized, 'EX', this.redis.marketSnapshotTtlSec).catch((err) => {
      this.logger.warn(
        `market index snapshot set failed key=${key}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    });

    await this.client.publish(channel, serialized).catch((err) => {
      this.logger.warn(
        `market index snapshot publish failed channel=${channel}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    });
  }

  async writeFx(entry: FxRateCacheEntry): Promise<void> {
    if (!this.client) {
      this.logger.debug('Redis disabled, skipping fx snapshot write');

      return;
    }

    const key = `${NAMESPACE}:v1:fx:latest:${entry.source}:${entry.pair}`;

    await this.client.set(key, safeStringify(entry), 'EX', this.redis.marketSnapshotTtlSec);
  }
}
