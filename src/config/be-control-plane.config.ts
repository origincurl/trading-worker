import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsString, Matches, MinLength, validateSync } from 'class-validator';

export class BeControlPlaneConfigDto {
  @IsString()
  @Matches(/^https?:\/\//, {
    message: 'BE_CONTROL_PLANE_URL must start with http:// or https://',
  })
  BE_CONTROL_PLANE_URL!: string;

  @IsString()
  @MinLength(16, {
    message: 'BE_HMAC_SECRET must be at least 16 characters',
  })
  BE_HMAC_SECRET!: string;

  @IsBoolean()
  BE_CONTROL_PLANE_MOCK: boolean = false;
}

export interface BeControlPlaneConfig {
  readonly url: string;
  readonly hmacSecret: string;
  readonly mock: boolean;
}

export function loadBeControlPlaneConfig(env: NodeJS.ProcessEnv): BeControlPlaneConfig {
  const dto = plainToInstance(
    BeControlPlaneConfigDto,
    {
      BE_CONTROL_PLANE_URL: env.BE_CONTROL_PLANE_URL ?? env.TRADING_BE_BASE_URL,
      BE_HMAC_SECRET: env.BE_HMAC_SECRET ?? env.RUNTIME_SERVICE_HMAC_SECRET,
      BE_CONTROL_PLANE_MOCK:
        env.BE_CONTROL_PLANE_MOCK === 'true' || env.BE_CONTROL_PLANE_MOCK === '1',
    },
    { exposeDefaultValues: true },
  );

  const errors = validateSync(dto, { whitelist: false });

  if (errors.length > 0) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ');

    throw new Error(`Invalid BE control-plane config: ${messages}`);
  }

  return {
    url: dto.BE_CONTROL_PLANE_URL,
    hmacSecret: dto.BE_HMAC_SECRET,
    mock: dto.BE_CONTROL_PLANE_MOCK,
  };
}

export const BE_CONTROL_PLANE_CONFIG = Symbol('BE_CONTROL_PLANE_CONFIG');
