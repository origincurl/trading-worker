import { plainToInstance, Type } from 'class-transformer';
import { IsInt, IsOptional, Min, validateSync } from 'class-validator';

// Phase 7: notifier role tunables. Outbox tick drives the dispatch loop;
// batch size + max attempts keep retries bounded so a flapping channel
// cannot starve other deliveries. Defaults match phase/07 spec.

export class NotifierConfigDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  NOTIFIER_OUTBOX_TICK_MS: number = 1000;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  NOTIFIER_OUTBOX_BATCH_SIZE: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  NOTIFIER_OUTBOX_MAX_ATTEMPTS: number = 5;
}

export interface NotifierConfig {
  readonly outboxTickMs: number;
  readonly outboxBatchSize: number;
  readonly outboxMaxAttempts: number;
}

export function loadNotifierConfig(env: NodeJS.ProcessEnv): NotifierConfig {
  const dto = plainToInstance(
    NotifierConfigDto,
    {
      NOTIFIER_OUTBOX_TICK_MS: env.NOTIFIER_OUTBOX_TICK_MS?.trim() || undefined,
      NOTIFIER_OUTBOX_BATCH_SIZE: env.NOTIFIER_OUTBOX_BATCH_SIZE?.trim() || undefined,
      NOTIFIER_OUTBOX_MAX_ATTEMPTS: env.NOTIFIER_OUTBOX_MAX_ATTEMPTS?.trim() || undefined,
    },
    { exposeDefaultValues: true },
  );

  const errors = validateSync(dto, { whitelist: false });

  if (errors.length > 0) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ');

    throw new Error(`Invalid notifier config: ${messages}`);
  }

  return {
    outboxTickMs: dto.NOTIFIER_OUTBOX_TICK_MS,
    outboxBatchSize: dto.NOTIFIER_OUTBOX_BATCH_SIZE,
    outboxMaxAttempts: dto.NOTIFIER_OUTBOX_MAX_ATTEMPTS,
  };
}

export const NOTIFIER_CONFIG = Symbol('NOTIFIER_CONFIG');
