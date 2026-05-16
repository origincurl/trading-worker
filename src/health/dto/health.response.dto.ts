import type { WorkerRole } from '@config/runtime.config';

export interface LiveResponseDto {
  status: 'ok';
  timestamp: string;
}

export type ReadyCheckState = 'ok' | 'unconfigured' | 'down';

export interface ReadyResponseDto {
  status: 'ok' | 'degraded';
  checks: {
    db: ReadyCheckState;
    redis: ReadyCheckState;
    roles: ReadyCheckState;
  };
  timestamp: string;
}

export interface RoleStatusDto {
  role: WorkerRole;
  ready: boolean;
  detail?: string;
}

export interface HealthResponseDto {
  status: 'ok';
  uptimeSec: number;
  workerInstanceId: string;
  activeRoles: readonly WorkerRole[];
  roleStatuses: readonly RoleStatusDto[];
  shard?: { index: number; count: number };
  nodeEnv: string;
  timestamp: string;
}
