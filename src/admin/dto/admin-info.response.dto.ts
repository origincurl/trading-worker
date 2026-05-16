import type { WorkerRole } from '@config/runtime.config';

export interface AdminInfoResponseDto {
  workerInstanceId: string;
  nodeEnv: string;
  activeRoles: readonly WorkerRole[];
  shard?: { index: number; count: number };
  kiwoom: { marketEnv: string; wsHost: string | null; restHost: string | null };
  be: { url: string; mock: boolean };
  uptimeSec: number;
  startedAtIso: string;
}
