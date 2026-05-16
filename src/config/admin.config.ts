import { plainToInstance } from 'class-transformer';
import { IsOptional, IsString, validateSync } from 'class-validator';

// Phase 10: ADMIN_TOKEN gates every /admin/* endpoint.
// Unset → the AuthGuard refuses all calls (boot logs a warning).
export class AdminConfigDto {
  @IsOptional()
  @IsString()
  ADMIN_TOKEN?: string;
}

export interface AdminConfig {
  readonly token?: string;
}

export function loadAdminConfig(env: NodeJS.ProcessEnv): AdminConfig {
  const dto = plainToInstance(AdminConfigDto, {
    ADMIN_TOKEN: env.ADMIN_TOKEN?.trim() || undefined,
  });

  const errors = validateSync(dto, { whitelist: false });

  if (errors.length > 0) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ');

    throw new Error(`Invalid admin config: ${messages}`);
  }

  return { token: dto.ADMIN_TOKEN };
}

export const ADMIN_CONFIG = Symbol('ADMIN_CONFIG');
