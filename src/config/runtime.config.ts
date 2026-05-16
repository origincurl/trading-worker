import { plainToInstance, Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Min, validateSync } from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export const KNOWN_ROLES = ['collector', 'calculator', 'executor', 'detector'] as const;

export type WorkerRole = (typeof KNOWN_ROLES)[number];

function parseRoles(raw: unknown): WorkerRole[] {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return [];
  }

  const parts = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);

  const unknown = parts.filter((part) => !KNOWN_ROLES.includes(part as WorkerRole));

  if (unknown.length > 0) {
    throw new Error(
      `ROLES contains unknown values: [${unknown.join(', ')}]. Allowed: ${KNOWN_ROLES.join(', ')}`,
    );
  }

  return Array.from(new Set(parts)) as WorkerRole[];
}

export class RuntimeConfigDto {
  @IsEnum(NodeEnv, {
    message: `NODE_ENV must be one of: ${Object.values(NodeEnv).join(', ')}`,
  })
  NODE_ENV!: NodeEnv;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  PORT: number = 4002;

  @IsString()
  @Matches(/^[A-Za-z0-9._-]+$/, {
    message: 'WORKER_INSTANCE_ID must be alphanumeric with . _ -',
  })
  WORKER_INSTANCE_ID!: string;

  @Transform(({ value }) => parseRoles(value), { toClassOnly: true })
  ROLES!: WorkerRole[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  SHARD_INDEX?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  SHARD_COUNT?: number;
}

export interface RuntimeConfig {
  readonly nodeEnv: NodeEnv;
  readonly port: number;
  readonly workerInstanceId: string;
  readonly roles: readonly WorkerRole[];
  readonly shardIndex?: number;
  readonly shardCount?: number;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  const cleaned = {
    NODE_ENV: env.NODE_ENV,
    PORT: env.PORT?.trim() || undefined,
    WORKER_INSTANCE_ID: env.WORKER_INSTANCE_ID,
    ROLES: env.ROLES,
    SHARD_INDEX: env.SHARD_INDEX?.trim() || undefined,
    SHARD_COUNT: env.SHARD_COUNT?.trim() || undefined,
  };

  const dto = plainToInstance(RuntimeConfigDto, cleaned, {
    enableImplicitConversion: false,
    exposeDefaultValues: true,
  });

  const errors = validateSync(dto, {
    whitelist: false,
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ');

    throw new Error(`Invalid runtime config: ${messages}`);
  }

  if (dto.ROLES.length === 0) {
    throw new Error('ROLES must declare at least one role');
  }

  const shardIndexDefined = dto.SHARD_INDEX !== undefined;
  const shardCountDefined = dto.SHARD_COUNT !== undefined;

  if (shardIndexDefined !== shardCountDefined) {
    throw new Error('SHARD_INDEX and SHARD_COUNT must be set together');
  }

  if (
    shardIndexDefined &&
    shardCountDefined &&
    (dto.SHARD_INDEX as number) >= (dto.SHARD_COUNT as number)
  ) {
    throw new Error(`SHARD_INDEX (${dto.SHARD_INDEX}) must be < SHARD_COUNT (${dto.SHARD_COUNT})`);
  }

  return {
    nodeEnv: dto.NODE_ENV,
    port: dto.PORT,
    workerInstanceId: dto.WORKER_INSTANCE_ID,
    roles: dto.ROLES,
    shardIndex: dto.SHARD_INDEX,
    shardCount: dto.SHARD_COUNT,
  };
}

export const RUNTIME_CONFIG = Symbol('RUNTIME_CONFIG');
