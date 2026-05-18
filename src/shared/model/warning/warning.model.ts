import { RiskType } from '@shared/model/risk/risk-type.enum';
import { WarningLevel } from './warning-level.enum';
import { WarningStatus } from './warning-status.enum';

export class WarningModel {
  id!: number;
  accountId!: number;
  accountRiskId!: number;
  riskId!: number;
  stockId!: number | null;
  riskType!: RiskType | null;
  level!: WarningLevel;
  status!: WarningStatus;
  title!: string | null;
  message!: string | null;
  reason!: string | null;
  indicatorSnapshot!: Record<string, unknown> | null;
  warningData!: Record<string, unknown> | null;
  warnedAt!: Date;
  readAt!: Date | null;
  resolvedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;
}
