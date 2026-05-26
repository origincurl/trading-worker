import { plainToInstance, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min, validateSync } from 'class-validator';

// Phase F: TRACKER_ACCOUNT_TARGETS env removed — tracker now resolves
// account targets from accounts/account_credentials tables directly via
// TrackerTargetService.
export class TrackerConfigDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  TRACKER_BALANCE_POLL_INTERVAL_SEC: number = 60;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  TRACKER_POSITION_POLL_INTERVAL_SEC: number = 60;

  @IsOptional()
  @IsString()
  TRACKER_LOG_LEVEL?: string;
}

export interface TrackerConfig {
  readonly balancePollIntervalSec: number;
  readonly positionPollIntervalSec: number;
}

export function loadTrackerConfig(env: NodeJS.ProcessEnv): TrackerConfig {
  const dto = plainToInstance(
    TrackerConfigDto,
    {
      TRACKER_BALANCE_POLL_INTERVAL_SEC: env.TRACKER_BALANCE_POLL_INTERVAL_SEC,
      TRACKER_POSITION_POLL_INTERVAL_SEC: env.TRACKER_POSITION_POLL_INTERVAL_SEC,
    },
    { exposeDefaultValues: true },
  );

  const errors = validateSync(dto, { whitelist: false });

  if (errors.length > 0) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ');

    throw new Error(`Invalid tracker config: ${messages}`);
  }

  return {
    balancePollIntervalSec: dto.TRACKER_BALANCE_POLL_INTERVAL_SEC,
    positionPollIntervalSec: dto.TRACKER_POSITION_POLL_INTERVAL_SEC,
  };
}

export const TRACKER_CONFIG = Symbol('TRACKER_CONFIG');
