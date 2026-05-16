import { plainToInstance, Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, validateSync } from 'class-validator';

// Phase 6: static bootstrap symbols. Phase 6.7 replaces this with BE
// control-plane universe lease. Symbols here are merely the seed list to
// prove the WS → mapper → pubsub path before BE integration.

function parseSymbols(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.trim().length === 0) return [];

  return Array.from(
    new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  );
}

function parseBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw !== 'string') return fallback;

  const v = raw.trim().toLowerCase();

  if (v === 'true' || v === '1') return true;

  if (v === 'false' || v === '0') return false;

  return fallback;
}

export class CollectorConfigDto {
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => parseSymbols(value), { toClassOnly: true })
  COLLECTOR_BOOTSTRAP_SYMBOLS!: string[];

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => parseBool(value, false), { toClassOnly: true })
  COLLECTOR_WS_LOG_FRAMES: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => parseBool(value, true), { toClassOnly: true })
  COLLECTOR_SUBSCRIBE_ORDERBOOK: boolean = true;
}

export interface CollectorConfig {
  readonly bootstrapSymbols: readonly string[];
  readonly wsLogFrames: boolean;
  readonly subscribeOrderbook: boolean;
}

export function loadCollectorConfig(env: NodeJS.ProcessEnv): CollectorConfig {
  const dto = plainToInstance(
    CollectorConfigDto,
    {
      COLLECTOR_BOOTSTRAP_SYMBOLS: env.COLLECTOR_BOOTSTRAP_SYMBOLS,
      COLLECTOR_WS_LOG_FRAMES: env.COLLECTOR_WS_LOG_FRAMES,
      COLLECTOR_SUBSCRIBE_ORDERBOOK: env.COLLECTOR_SUBSCRIBE_ORDERBOOK,
    },
    { exposeDefaultValues: true },
  );

  const errors = validateSync(dto, { whitelist: false });

  if (errors.length > 0) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ');

    throw new Error(`Invalid collector config: ${messages}`);
  }

  return {
    bootstrapSymbols: dto.COLLECTOR_BOOTSTRAP_SYMBOLS,
    wsLogFrames: dto.COLLECTOR_WS_LOG_FRAMES,
    subscribeOrderbook: dto.COLLECTOR_SUBSCRIBE_ORDERBOOK,
  };
}

export const COLLECTOR_CONFIG = Symbol('COLLECTOR_CONFIG');
