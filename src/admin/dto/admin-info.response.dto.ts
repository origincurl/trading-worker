import type { WorkerRole } from '@config/runtime.config';
import type { CredentialUsageSnapshot } from '@external/brokerage/credential/credential-usage.service';

export interface AdminInfoResponseDto {
  workerInstanceId: string;
  nodeEnv: string;
  activeRoles: readonly WorkerRole[];
  shard?: { index: number; count: number };
  kiwoom: { marketEnv: string; wsHost: string | null; restHost: string | null };
  credentialUsage?: readonly CredentialUsageSnapshot[];
  uptimeSec: number;
  startedAtIso: string;
}
