import { plainToInstance, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Min, validateSync } from 'class-validator';

export class RedisConfigDto {
  @IsOptional()
  @IsString()
  @Matches(/^rediss?:\/\//, {
    message: 'REDIS_URL must start with redis:// or rediss://',
  })
  REDIS_URL?: string;

  @IsString()
  REDIS_KEY_PREFIX: string = 'worker';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  REDIS_LATEST_TTL_SEC: number = 60;

  @Type(() => Number)
  @IsInt()
  @Min(30)
  REDIS_MARKET_SNAPSHOT_TTL_SEC: number = 600;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  REDIS_HEARTBEAT_TTL_SEC: number = 45;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  REDIS_HEARTBEAT_INTERVAL_SEC: number = 10;
}

export interface RedisConfig {
  readonly url?: string;
  readonly keyPrefix: string;
  readonly latestTtlSec: number;
  readonly marketSnapshotTtlSec: number;
  readonly heartbeatTtlSec: number;
  readonly heartbeatIntervalSec: number;
}

export function loadRedisConfig(env: NodeJS.ProcessEnv): RedisConfig {
  const dto = plainToInstance(
    RedisConfigDto,
    {
      REDIS_URL: env.REDIS_URL?.trim() || undefined,
      REDIS_KEY_PREFIX: env.REDIS_KEY_PREFIX,
      REDIS_LATEST_TTL_SEC: env.REDIS_LATEST_TTL_SEC,
      REDIS_MARKET_SNAPSHOT_TTL_SEC: env.REDIS_MARKET_SNAPSHOT_TTL_SEC,
      REDIS_HEARTBEAT_TTL_SEC: env.REDIS_HEARTBEAT_TTL_SEC,
      REDIS_HEARTBEAT_INTERVAL_SEC: env.REDIS_HEARTBEAT_INTERVAL_SEC,
    },
    { exposeDefaultValues: true },
  );

  const errors = validateSync(dto, { whitelist: false });

  if (errors.length > 0) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ');

    throw new Error(`Invalid redis config: ${messages}`);
  }

  if (dto.REDIS_HEARTBEAT_INTERVAL_SEC >= dto.REDIS_HEARTBEAT_TTL_SEC) {
    throw new Error(
      `REDIS_HEARTBEAT_INTERVAL_SEC (${dto.REDIS_HEARTBEAT_INTERVAL_SEC}) must be < REDIS_HEARTBEAT_TTL_SEC (${dto.REDIS_HEARTBEAT_TTL_SEC})`,
    );
  }

  return {
    url: dto.REDIS_URL,
    keyPrefix: dto.REDIS_KEY_PREFIX,
    latestTtlSec: dto.REDIS_LATEST_TTL_SEC,
    marketSnapshotTtlSec: dto.REDIS_MARKET_SNAPSHOT_TTL_SEC,
    heartbeatTtlSec: dto.REDIS_HEARTBEAT_TTL_SEC,
    heartbeatIntervalSec: dto.REDIS_HEARTBEAT_INTERVAL_SEC,
  };
}

export const REDIS_CONFIG = Symbol('REDIS_CONFIG');
