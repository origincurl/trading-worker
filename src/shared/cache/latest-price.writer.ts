import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { REDIS_CONFIG, type RedisConfig } from '@config/redis.config';
import { safeStringify } from '@common/util/safe-stringify';
import { REDIS_CLIENT, type RedisClientToken } from './redis.tokens';
import { RedisKeyBuilder } from './redis-key.builder';

// Phase 2: skeleton only. Phase 6 wires this into the collector pipeline.
// Lives in shared/cache because BE may also need to read these keys (same
// schema, prefix stays `worker:`), and the writer side stays here.
@Injectable()
export class LatestPriceWriter {
  private readonly logger = new Logger(LatestPriceWriter.name);

  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly client: RedisClientToken,
    @Inject(REDIS_CONFIG) private readonly config: RedisConfig,
    private readonly keys: RedisKeyBuilder,
  ) {}

  async write(provider: string, symbol: string, snapshot: unknown): Promise<void> {
    if (!this.client) {
      this.logger.debug('Redis disabled, skipping latest-price write');

      return;
    }

    const key = this.keys.build('latest', provider, symbol);

    await this.client.set(key, safeStringify(snapshot), 'EX', this.config.latestTtlSec);
  }
}
