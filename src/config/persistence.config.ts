import { plainToInstance } from 'class-transformer';
import { IsOptional, IsString, Matches, validateSync } from 'class-validator';

export class PersistenceConfigDto {
  @IsOptional()
  @IsString()
  @Matches(/^postgres(ql)?:\/\//, {
    message: 'WORKER_DATABASE_URL must start with postgres:// or postgresql://',
  })
  WORKER_DATABASE_URL?: string;
}

export interface PersistenceConfig {
  readonly databaseUrl?: string;
}

export function loadPersistenceConfig(env: NodeJS.ProcessEnv): PersistenceConfig {
  // backwards-compat: MARKET_RUNTIME_DATABASE_URL → WORKER_DATABASE_URL.
  // Empty string is treated as "not configured" (graceful degraded boot),
  // distinct from "set but malformed" which still throws.
  const raw = env.WORKER_DATABASE_URL ?? env.MARKET_RUNTIME_DATABASE_URL;
  const merged = {
    WORKER_DATABASE_URL: raw?.trim() || undefined,
  };

  const dto = plainToInstance(PersistenceConfigDto, merged);

  const errors = validateSync(dto, { whitelist: false });

  if (errors.length > 0) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ');

    throw new Error(`Invalid persistence config: ${messages}`);
  }

  return {
    databaseUrl: dto.WORKER_DATABASE_URL,
  };
}

export const PERSISTENCE_CONFIG = Symbol('PERSISTENCE_CONFIG');
