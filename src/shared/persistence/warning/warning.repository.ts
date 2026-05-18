import type { RiskType } from '@shared/model/risk/risk-type.enum';
import type { WarningLevel } from '@shared/model/warning/warning-level.enum';
import type { WarningStatus } from '@shared/model/warning/warning-status.enum';
import type { WarningModel } from '@shared/model/warning/warning.model';

export interface CreateWarningInput {
  readonly accountId: number;
  readonly accountRiskId: number;
  readonly riskId: number;
  readonly stockId: number | null;
  readonly riskType: RiskType | null;
  readonly level: WarningLevel;
  readonly status: WarningStatus;
  readonly title: string | null;
  readonly message: string | null;
  readonly reason: string | null;
  readonly indicatorSnapshot: Record<string, unknown> | null;
  readonly warningData: Record<string, unknown> | null;
  readonly warnedAt: Date;
}

export interface WarningRepository {
  createWarning(input: CreateWarningInput): Promise<WarningModel>;
}
