import { plainToInstance, Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, validateSync } from 'class-validator';

export type ChartArchiveMarketEnv = 'mock' | 'production';

function parseBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw !== 'string') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return fallback;
}

function parseMarketEnvs(raw: unknown): ChartArchiveMarketEnv[] {
  if (typeof raw !== 'string' || raw.trim() === '') return ['production'];
  const values = raw
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  const accepted = values.filter((v): v is ChartArchiveMarketEnv => v === 'mock' || v === 'production');
  return accepted.length > 0 ? accepted : ['production'];
}

export class ChartArchiveConfigDto {
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => parseBool(value, false), { toClassOnly: true })
  CHART_ARCHIVE_ENABLED: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => parseBool(value, false), { toClassOnly: true })
  CHART_ARCHIVE_DRY_RUN: boolean = false;

  @IsOptional()
  @IsString()
  CHART_ARCHIVE_S3_BUCKET: string = '';

  @IsOptional()
  @IsString()
  CHART_ARCHIVE_S3_PREFIX: string = 'charts';

  @IsOptional()
  @IsString()
  CHART_ARCHIVE_AWS_REGION: string = 'ap-northeast-2';

  @IsOptional()
  @IsString()
  CHART_ARCHIVE_S3_ENDPOINT: string = '';

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => parseBool(value, false), { toClassOnly: true })
  CHART_ARCHIVE_S3_FORCE_PATH_STYLE: boolean = false;

  @IsOptional()
  @Transform(({ value }) => parseMarketEnvs(value), { toClassOnly: true })
  CHART_ARCHIVE_MARKET_ENVS: ChartArchiveMarketEnv[] = ['production'];

  @IsOptional()
  @IsString()
  @IsIn(['P1', 'P2', 'P3', 'P4'])
  CHART_ARCHIVE_PRIORITY: string = 'P3';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  CHART_ARCHIVE_CONCURRENCY: number = 2;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  CHART_ARCHIVE_LOCK_TTL_SEC: number = 7200;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  CHART_ARCHIVE_AGG_LOCK_TTL_SEC: number = 120;

  @IsOptional()
  @IsString()
  CHART_ARCHIVE_TIME_KST: string = '20:00';

  @IsOptional()
  @IsString()
  CHART_ARCHIVE_WINDOW_END_KST: string = '06:00';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  CHART_ARCHIVE_TASK_MAX_ATTEMPTS: number = 5;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  CHART_ARCHIVE_AGG_LOCK_RETRY_COUNT: number = 3;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  CHART_ARCHIVE_AGG_LOCK_RETRY_DELAY_MS: number = 5_000;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => parseBool(value, false), { toClassOnly: true })
  CHART_ARCHIVE_CALENDAR_SYNC_ENABLED: boolean = false;

  @IsOptional()
  @IsString()
  CHART_ARCHIVE_CALENDAR_SYNC_TIME_KST: string = '06:10';

  @IsOptional()
  @IsString()
  CHART_ARCHIVE_CALENDAR_SYNC_URL: string = '';

  @IsOptional()
  @IsString()
  CHART_ARCHIVE_CALENDAR_SYNC_FILE: string = '';

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => parseBool(value, false), { toClassOnly: true })
  CHART_ARCHIVE_CALENDAR_REQUIRE_DB: boolean = false;
}

export interface ChartArchiveConfig {
  readonly enabled: boolean;
  readonly dryRun: boolean;
  readonly bucket: string;
  readonly prefix: string;
  readonly region: string;
  readonly s3Endpoint: string;
  readonly s3ForcePathStyle: boolean;
  readonly marketEnvs: readonly ChartArchiveMarketEnv[];
  readonly priority: 'P1' | 'P2' | 'P3' | 'P4';
  readonly concurrency: number;
  readonly lockTtlSec: number;
  readonly aggregateLockTtlSec: number;
  readonly timeKst: string;
  readonly windowEndKst: string;
  readonly taskMaxAttempts: number;
  readonly aggregateLockRetryCount: number;
  readonly aggregateLockRetryDelayMs: number;
  readonly calendarSyncEnabled: boolean;
  readonly calendarSyncTimeKst: string;
  readonly calendarSyncUrl: string;
  readonly calendarSyncFile: string;
  readonly calendarRequireDb: boolean;
}

export function loadChartArchiveConfig(env: NodeJS.ProcessEnv): ChartArchiveConfig {
  const dto = plainToInstance(
    ChartArchiveConfigDto,
    {
      CHART_ARCHIVE_ENABLED: env.CHART_ARCHIVE_ENABLED,
      CHART_ARCHIVE_DRY_RUN: env.CHART_ARCHIVE_DRY_RUN,
      CHART_ARCHIVE_S3_BUCKET: env.CHART_ARCHIVE_S3_BUCKET ?? env.S3_BUCKET_NAME,
      CHART_ARCHIVE_S3_PREFIX: env.CHART_ARCHIVE_S3_PREFIX,
      CHART_ARCHIVE_AWS_REGION: env.CHART_ARCHIVE_AWS_REGION ?? env.AWS_REGION,
      CHART_ARCHIVE_S3_ENDPOINT: env.CHART_ARCHIVE_S3_ENDPOINT ?? env.AWS_ENDPOINT_URL_S3,
      CHART_ARCHIVE_S3_FORCE_PATH_STYLE: env.CHART_ARCHIVE_S3_FORCE_PATH_STYLE,
      CHART_ARCHIVE_MARKET_ENVS: env.CHART_ARCHIVE_MARKET_ENVS,
      CHART_ARCHIVE_PRIORITY: env.CHART_ARCHIVE_PRIORITY,
      CHART_ARCHIVE_CONCURRENCY: env.CHART_ARCHIVE_CONCURRENCY,
      CHART_ARCHIVE_LOCK_TTL_SEC: env.CHART_ARCHIVE_LOCK_TTL_SEC,
      CHART_ARCHIVE_AGG_LOCK_TTL_SEC: env.CHART_ARCHIVE_AGG_LOCK_TTL_SEC,
      CHART_ARCHIVE_TIME_KST: env.CHART_ARCHIVE_TIME_KST,
      CHART_ARCHIVE_WINDOW_END_KST: env.CHART_ARCHIVE_WINDOW_END_KST,
      CHART_ARCHIVE_TASK_MAX_ATTEMPTS: env.CHART_ARCHIVE_TASK_MAX_ATTEMPTS,
      CHART_ARCHIVE_AGG_LOCK_RETRY_COUNT: env.CHART_ARCHIVE_AGG_LOCK_RETRY_COUNT,
      CHART_ARCHIVE_AGG_LOCK_RETRY_DELAY_MS: env.CHART_ARCHIVE_AGG_LOCK_RETRY_DELAY_MS,
      CHART_ARCHIVE_CALENDAR_SYNC_ENABLED: env.CHART_ARCHIVE_CALENDAR_SYNC_ENABLED,
      CHART_ARCHIVE_CALENDAR_SYNC_TIME_KST: env.CHART_ARCHIVE_CALENDAR_SYNC_TIME_KST,
      CHART_ARCHIVE_CALENDAR_SYNC_URL: env.CHART_ARCHIVE_CALENDAR_SYNC_URL,
      CHART_ARCHIVE_CALENDAR_SYNC_FILE: env.CHART_ARCHIVE_CALENDAR_SYNC_FILE,
      CHART_ARCHIVE_CALENDAR_REQUIRE_DB: env.CHART_ARCHIVE_CALENDAR_REQUIRE_DB,
    },
    { exposeDefaultValues: true },
  );

  const errors = validateSync(dto, { whitelist: false });
  if (errors.length > 0) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ');
    throw new Error(`Invalid chart archive config: ${messages}`);
  }

  return {
    enabled: dto.CHART_ARCHIVE_ENABLED,
    dryRun: dto.CHART_ARCHIVE_DRY_RUN,
    bucket: dto.CHART_ARCHIVE_S3_BUCKET,
    prefix: dto.CHART_ARCHIVE_S3_PREFIX.replace(/^\/+|\/+$/g, ''),
    region: dto.CHART_ARCHIVE_AWS_REGION,
    s3Endpoint: dto.CHART_ARCHIVE_S3_ENDPOINT,
    s3ForcePathStyle: dto.CHART_ARCHIVE_S3_FORCE_PATH_STYLE,
    marketEnvs: dto.CHART_ARCHIVE_MARKET_ENVS,
    priority: dto.CHART_ARCHIVE_PRIORITY as ChartArchiveConfig['priority'],
    concurrency: dto.CHART_ARCHIVE_CONCURRENCY,
    lockTtlSec: dto.CHART_ARCHIVE_LOCK_TTL_SEC,
    aggregateLockTtlSec: dto.CHART_ARCHIVE_AGG_LOCK_TTL_SEC,
    timeKst: dto.CHART_ARCHIVE_TIME_KST,
    windowEndKst: dto.CHART_ARCHIVE_WINDOW_END_KST,
    taskMaxAttempts: dto.CHART_ARCHIVE_TASK_MAX_ATTEMPTS,
    aggregateLockRetryCount: dto.CHART_ARCHIVE_AGG_LOCK_RETRY_COUNT,
    aggregateLockRetryDelayMs: dto.CHART_ARCHIVE_AGG_LOCK_RETRY_DELAY_MS,
    calendarSyncEnabled: dto.CHART_ARCHIVE_CALENDAR_SYNC_ENABLED,
    calendarSyncTimeKst: dto.CHART_ARCHIVE_CALENDAR_SYNC_TIME_KST,
    calendarSyncUrl: dto.CHART_ARCHIVE_CALENDAR_SYNC_URL,
    calendarSyncFile: dto.CHART_ARCHIVE_CALENDAR_SYNC_FILE,
    calendarRequireDb: dto.CHART_ARCHIVE_CALENDAR_REQUIRE_DB,
  };
}

export const CHART_ARCHIVE_CONFIG = Symbol('CHART_ARCHIVE_CONFIG');
