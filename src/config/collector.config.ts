import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  validateSync,
} from 'class-validator';

function parseBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw !== 'string') return fallback;

  const v = raw.trim().toLowerCase();

  if (v === 'true' || v === '1') return true;

  if (v === 'false' || v === '0') return false;

  return fallback;
}

export class CollectorConfigDto {
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => parseBool(value, false), { toClassOnly: true })
  COLLECTOR_WS_LOG_FRAMES: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => parseBool(value, true), { toClassOnly: true })
  COLLECTOR_SUBSCRIBE_ORDERBOOK: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => parseBool(value, true), { toClassOnly: true })
  COLLECTOR_SUBSCRIBE_MARKET_INDEX: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => parseBool(value, true), { toClassOnly: true })
  COLLECTOR_MARKET_SNAPSHOT_ENABLED: boolean = true;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  COLLECTOR_INDEX_INTERVAL_SEC: number = 300;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  COLLECTOR_FX_INTERVAL_SEC: number = 300;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  COLLECTOR_DASHBOARD_INTERVAL_SEC: number = 30;

  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: true, protocols: ['https'] })
  COLLECTOR_FX_LATEST_URL: string = 'https://cdn.moneyconvert.net/api/latest.json';
}

export interface CollectorConfig {
  readonly wsLogFrames: boolean;
  readonly subscribeOrderbook: boolean;
  readonly subscribeMarketIndex: boolean;
  readonly marketSnapshotEnabled: boolean;
  readonly indexIntervalSec: number;
  readonly fxIntervalSec: number;
  readonly dashboardIntervalSec: number;
  readonly fxLatestUrl: string;
}

export function loadCollectorConfig(env: NodeJS.ProcessEnv): CollectorConfig {
  const dto = plainToInstance(
    CollectorConfigDto,
    {
      COLLECTOR_WS_LOG_FRAMES: env.COLLECTOR_WS_LOG_FRAMES,
      COLLECTOR_SUBSCRIBE_ORDERBOOK: env.COLLECTOR_SUBSCRIBE_ORDERBOOK,
      COLLECTOR_SUBSCRIBE_MARKET_INDEX: env.COLLECTOR_SUBSCRIBE_MARKET_INDEX,
      COLLECTOR_MARKET_SNAPSHOT_ENABLED: env.COLLECTOR_MARKET_SNAPSHOT_ENABLED,
      COLLECTOR_INDEX_INTERVAL_SEC: env.COLLECTOR_INDEX_INTERVAL_SEC,
      COLLECTOR_FX_INTERVAL_SEC: env.COLLECTOR_FX_INTERVAL_SEC,
      COLLECTOR_DASHBOARD_INTERVAL_SEC: env.COLLECTOR_DASHBOARD_INTERVAL_SEC,
      COLLECTOR_FX_LATEST_URL: env.COLLECTOR_FX_LATEST_URL,
    },
    { exposeDefaultValues: true },
  );

  const errors = validateSync(dto, { whitelist: false });

  if (errors.length > 0) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ');

    throw new Error(`Invalid collector config: ${messages}`);
  }

  return {
    wsLogFrames: dto.COLLECTOR_WS_LOG_FRAMES,
    subscribeOrderbook: dto.COLLECTOR_SUBSCRIBE_ORDERBOOK,
    subscribeMarketIndex: dto.COLLECTOR_SUBSCRIBE_MARKET_INDEX,
    marketSnapshotEnabled: dto.COLLECTOR_MARKET_SNAPSHOT_ENABLED,
    indexIntervalSec: dto.COLLECTOR_INDEX_INTERVAL_SEC,
    fxIntervalSec: dto.COLLECTOR_FX_INTERVAL_SEC,
    dashboardIntervalSec: dto.COLLECTOR_DASHBOARD_INTERVAL_SEC,
    fxLatestUrl: dto.COLLECTOR_FX_LATEST_URL,
  };
}

export const COLLECTOR_CONFIG = Symbol('COLLECTOR_CONFIG');
