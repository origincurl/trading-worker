import { Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { IsEnum, IsOptional, IsString, validateSync } from 'class-validator';
import type { WorkerRole } from './runtime.config';

const logger = new Logger('KiwoomConfig');

export enum KiwoomMarketEnv {
  Mock = 'mock',
  Production = 'production',
}

const HOST_BY_ENV: Record<KiwoomMarketEnv, { ws: string; rest: string }> = {
  [KiwoomMarketEnv.Mock]: {
    ws: 'mockapi.kiwoom.com',
    rest: 'mockapi.kiwoom.com',
  },
  [KiwoomMarketEnv.Production]: {
    ws: 'api.kiwoom.com',
    rest: 'api.kiwoom.com',
  },
};

export class KiwoomConfigDto {
  @IsEnum(KiwoomMarketEnv, { message: 'KIWOOM_MARKET_ENV must be mock or production' })
  KIWOOM_MARKET_ENV!: KiwoomMarketEnv;

  @IsOptional()
  @IsString()
  KIWOOM_WS_URL?: string;

  @IsOptional()
  @IsString()
  KIWOOM_REST_URL?: string;

  @IsOptional()
  @IsString()
  KIWOOM_COLLECTOR_APP_KEY?: string;

  @IsOptional()
  @IsString()
  KIWOOM_COLLECTOR_APP_SECRET?: string;

  @IsOptional()
  @IsString()
  KIWOOM_EXECUTOR_APP_KEY?: string;

  @IsOptional()
  @IsString()
  KIWOOM_EXECUTOR_APP_SECRET?: string;
}

export interface KiwoomConfig {
  readonly marketEnv: KiwoomMarketEnv;
  readonly wsUrl?: string;
  readonly restUrl?: string;
  readonly collector?: {
    appKey: string;
    appSecret: string;
  };
  readonly executor?: {
    appKey: string;
    appSecret: string;
  };
}

function hostMatches(url: string | undefined, expectedHost: string): boolean {
  if (!url) return true;

  try {
    const parsed = new URL(url);

    return parsed.hostname === expectedHost;
  } catch {
    return false;
  }
}

export function loadKiwoomConfig(
  env: NodeJS.ProcessEnv,
  activeRoles: readonly WorkerRole[],
): KiwoomConfig {
  const dto = plainToInstance(KiwoomConfigDto, {
    KIWOOM_MARKET_ENV: env.KIWOOM_MARKET_ENV,
    KIWOOM_WS_URL: env.KIWOOM_WS_URL,
    KIWOOM_REST_URL: env.KIWOOM_REST_URL,
    KIWOOM_COLLECTOR_APP_KEY: env.KIWOOM_COLLECTOR_APP_KEY ?? env.KIWOOM_APP_KEY,
    KIWOOM_COLLECTOR_APP_SECRET: env.KIWOOM_COLLECTOR_APP_SECRET ?? env.KIWOOM_APP_SECRET,
    KIWOOM_EXECUTOR_APP_KEY: env.KIWOOM_EXECUTOR_APP_KEY,
    KIWOOM_EXECUTOR_APP_SECRET: env.KIWOOM_EXECUTOR_APP_SECRET,
  });

  const errors = validateSync(dto, { whitelist: false });

  if (errors.length > 0) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ');

    throw new Error(`Invalid kiwoom config: ${messages}`);
  }

  const expected = HOST_BY_ENV[dto.KIWOOM_MARKET_ENV];

  if (!hostMatches(dto.KIWOOM_WS_URL, expected.ws)) {
    throw new Error(
      `KIWOOM_WS_URL host does not match KIWOOM_MARKET_ENV=${dto.KIWOOM_MARKET_ENV} (expected host: ${expected.ws})`,
    );
  }

  if (!hostMatches(dto.KIWOOM_REST_URL, expected.rest)) {
    throw new Error(
      `KIWOOM_REST_URL host does not match KIWOOM_MARKET_ENV=${dto.KIWOOM_MARKET_ENV} (expected host: ${expected.rest})`,
    );
  }

  const needsCollector = activeRoles.includes('collector');
  const needsExecutor = activeRoles.includes('executor');

  let collector: KiwoomConfig['collector'];
  let executor: KiwoomConfig['executor'];

  if (needsCollector) {
    if (!dto.KIWOOM_COLLECTOR_APP_KEY || !dto.KIWOOM_COLLECTOR_APP_SECRET) {
      throw new Error(
        'KIWOOM_COLLECTOR_APP_KEY and KIWOOM_COLLECTOR_APP_SECRET are required when role=collector is active',
      );
    }

    collector = {
      appKey: dto.KIWOOM_COLLECTOR_APP_KEY,
      appSecret: dto.KIWOOM_COLLECTOR_APP_SECRET,
    };
  }

  if (needsExecutor) {
    if (!dto.KIWOOM_EXECUTOR_APP_KEY || !dto.KIWOOM_EXECUTOR_APP_SECRET) {
      throw new Error(
        'KIWOOM_EXECUTOR_APP_KEY and KIWOOM_EXECUTOR_APP_SECRET are required when role=executor is active',
      );
    }

    executor = {
      appKey: dto.KIWOOM_EXECUTOR_APP_KEY,
      appSecret: dto.KIWOOM_EXECUTOR_APP_SECRET,
    };
  }

  if (collector && executor && collector.appKey === executor.appKey) {
    const allowSameKey = env.KIWOOM_ALLOW_SAME_KEY === 'true' || env.KIWOOM_ALLOW_SAME_KEY === '1';

    if (!allowSameKey) {
      throw new Error(
        'KIWOOM_COLLECTOR_APP_KEY and KIWOOM_EXECUTOR_APP_KEY must be different (vendor credential isolation). ' +
          'Set KIWOOM_ALLOW_SAME_KEY=true to bypass for local dev only — NEVER use in production.',
      );
    }

    if (dto.KIWOOM_MARKET_ENV === 'production') {
      throw new Error(
        'KIWOOM_ALLOW_SAME_KEY=true is FORBIDDEN when KIWOOM_MARKET_ENV=production. ' +
          'Collector and executor MUST use distinct vendor credentials in production (rate-budget isolation).',
      );
    }

    logger.warn(
      `KIWOOM_ALLOW_SAME_KEY=true — collector/executor share the same vendor key. ` +
        `Local dev only. Rate-budget isolation guarantees are VOID in this mode.`,
    );

    // Kiwoom WS server allows only ONE session per app key. Loading
    // BOTH roles in the same process with a shared key triggers an
    // endless eviction loop (each new LOGIN kicks the prior session).
    // The collector + executor combo MUST split into separate processes
    // when keys are shared.
    if (needsCollector && needsExecutor) {
      throw new Error(
        'KIWOOM_ALLOW_SAME_KEY=true with ROLES containing both collector and executor is not supported. ' +
          'Kiwoom WS allows one session per app key — the shared key produces an endless reconnect loop. ' +
          'Either (a) set ROLES to a single role, or (b) provide distinct KIWOOM_COLLECTOR_APP_KEY / KIWOOM_EXECUTOR_APP_KEY.',
      );
    }
  }

  return {
    marketEnv: dto.KIWOOM_MARKET_ENV,
    wsUrl: dto.KIWOOM_WS_URL,
    restUrl: dto.KIWOOM_REST_URL,
    collector,
    executor,
  };
}

export const KIWOOM_CONFIG = Symbol('KIWOOM_CONFIG');
