import { plainToInstance } from 'class-transformer';
import { IsEnum, IsOptional, IsString, validateSync } from 'class-validator';

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

// Phase C: app key / app secret env vars are gone — credentials come from
// the DB (collector_credentials + api_credentials) via
// CredentialSourceService. KiwoomConfig now only carries the vendor host /
// market env values that don't rotate.
export class KiwoomConfigDto {
  @IsEnum(KiwoomMarketEnv, { message: 'KIWOOM_MARKET_ENV must be mock or production' })
  KIWOOM_MARKET_ENV!: KiwoomMarketEnv;

  @IsOptional()
  @IsString()
  KIWOOM_WS_URL?: string;

  @IsOptional()
  @IsString()
  KIWOOM_REST_URL?: string;
}

export interface KiwoomConfig {
  readonly marketEnv: KiwoomMarketEnv;
  readonly wsUrl?: string;
  readonly restUrl?: string;
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

export function loadKiwoomConfig(env: NodeJS.ProcessEnv): KiwoomConfig {
  const dto = plainToInstance(KiwoomConfigDto, {
    KIWOOM_MARKET_ENV: env.KIWOOM_MARKET_ENV,
    KIWOOM_WS_URL: env.KIWOOM_WS_URL,
    KIWOOM_REST_URL: env.KIWOOM_REST_URL,
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

  return {
    marketEnv: dto.KIWOOM_MARKET_ENV,
    wsUrl: dto.KIWOOM_WS_URL,
    restUrl: dto.KIWOOM_REST_URL,
  };
}

export const KIWOOM_CONFIG = Symbol('KIWOOM_CONFIG');
