import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { REDIS_CLIENT, type RedisClientToken } from '@shared/cache/redis.module';
import {
  heldPositionDemandMarketPattern,
  symbolFromHeldPositionDemandLeaseKey,
} from '@shared/cache/held-position-demand.keys';
import type { ObservedSymbolModel } from '@shared/model/universe/observed-symbol.model';

const SYMBOL_VALUE_PATTERN = /^[A-Za-z0-9._-]{1,20}$/;

// Broker REST position snapshots are not a live price source, but held
// symbols are hard market-data demand. Collector owns market WS, so it folds
// positive broker positions into the same deduped universe as chart and
// strategy symbols.
@Injectable()
export class HeldPositionDemandService {
  private readonly logger = new Logger(HeldPositionDemandService.name);

  constructor(
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: RedisClientToken,
  ) {}

  async activeSymbols(): Promise<ObservedSymbolModel[]> {
    if (!this.redis) return [];

    try {
      const keys = await scanKeys(this.redis, heldPositionDemandMarketPattern(this.kiwoom.marketEnv));
      const symbols = normalizeSymbols(
        keys
          .map((key) => symbolFromHeldPositionDemandLeaseKey(key))
          .filter((symbol): symbol is string => !!symbol),
      );

      this.logger.log(`held position demand symbols=${symbols.length}`);

      return symbols.map((symbol) => ({
        symbol,
        source: 'POSITION' as const,
        instrumentType: 'STOCK' as const,
      }));
    } catch (err) {
      this.logger.warn(
        `held position demand scan failed: ${err instanceof Error ? err.message : err}`,
      );

      return [];
    }
  }
}

function normalizeSymbols(symbols: readonly string[]): string[] {
  return Array.from(
    new Set(
      symbols
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => SYMBOL_VALUE_PATTERN.test(symbol)),
    ),
  ).sort();
}

async function scanKeys(redis: RedisClientToken, pattern: string): Promise<string[]> {
  if (!redis) return [];

  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');

  return keys;
}
