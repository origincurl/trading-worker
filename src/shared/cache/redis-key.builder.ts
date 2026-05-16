import { Inject, Injectable } from '@nestjs/common';
import { KIWOOM_CONFIG, type KiwoomConfig } from '@config/kiwoom.config';
import { REDIS_CONFIG, type RedisConfig } from '@config/redis.config';

const SAFE_SEGMENT = /^[A-Za-z0-9._:-]+$/;

export function assertSafeKeySegment(segment: string): void {
  if (typeof segment !== 'string' || segment.length === 0) {
    throw new Error('Redis key segment must be a non-empty string');
  }

  if (!SAFE_SEGMENT.test(segment)) {
    throw new Error(
      `Redis key segment contains forbidden characters: ${JSON.stringify(segment)} (allowed: [A-Za-z0-9._:-])`,
    );
  }
}

@Injectable()
export class RedisKeyBuilder {
  constructor(
    @Inject(REDIS_CONFIG) private readonly redis: RedisConfig,
    @Inject(KIWOOM_CONFIG) private readonly kiwoom: KiwoomConfig,
  ) {}

  // Final shape: {prefix}:{env}:{domain}:{...segments}
  build(domain: string, ...segments: string[]): string {
    assertSafeKeySegment(this.redis.keyPrefix);

    assertSafeKeySegment(this.kiwoom.marketEnv);

    assertSafeKeySegment(domain);

    for (const seg of segments) {
      assertSafeKeySegment(seg);
    }

    return [this.redis.keyPrefix, this.kiwoom.marketEnv, domain, ...segments].join(':');
  }

  // Pub/sub channel and stream name use dot-notation per architecture.md §8.
  // We keep them separate from the colon-prefixed key namespace to match the
  // patterns documented in phase/03-shared-infra.md.
  channel(...segments: string[]): string {
    for (const seg of segments) {
      assertSafeKeySegment(seg);
    }

    return segments.join('.');
  }
}
