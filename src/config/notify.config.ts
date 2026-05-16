import { plainToInstance, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Min, validateSync } from 'class-validator';

export class NotifyConfigDto {
  @IsOptional()
  @IsString()
  @Matches(/^https?:\/\//, {
    message: 'SLACK_DEFAULT_WEBHOOK_URL must start with http:// or https://',
  })
  SLACK_DEFAULT_WEBHOOK_URL?: string;

  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  SMTP_PORT?: number;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASS?: string;
}

export interface NotifyConfig {
  readonly slack?: { defaultWebhookUrl: string };
  readonly smtp?: {
    host: string;
    port: number;
    user?: string;
    pass?: string;
  };
}

export function loadNotifyConfig(env: NodeJS.ProcessEnv): NotifyConfig {
  const dto = plainToInstance(
    NotifyConfigDto,
    {
      SLACK_DEFAULT_WEBHOOK_URL: env.SLACK_DEFAULT_WEBHOOK_URL?.trim() || undefined,
      SMTP_HOST: env.SMTP_HOST?.trim() || undefined,
      SMTP_PORT: env.SMTP_PORT?.trim() || undefined,
      SMTP_USER: env.SMTP_USER?.trim() || undefined,
      SMTP_PASS: env.SMTP_PASS?.trim() || undefined,
    },
    { exposeDefaultValues: true },
  );

  const errors = validateSync(dto, { whitelist: false });

  if (errors.length > 0) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ');

    throw new Error(`Invalid notify config: ${messages}`);
  }

  const slack = dto.SLACK_DEFAULT_WEBHOOK_URL
    ? { defaultWebhookUrl: dto.SLACK_DEFAULT_WEBHOOK_URL }
    : undefined;

  const smtp =
    dto.SMTP_HOST && dto.SMTP_PORT
      ? { host: dto.SMTP_HOST, port: dto.SMTP_PORT, user: dto.SMTP_USER, pass: dto.SMTP_PASS }
      : undefined;

  return { slack, smtp };
}

export const NOTIFY_CONFIG = Symbol('NOTIFY_CONFIG');
