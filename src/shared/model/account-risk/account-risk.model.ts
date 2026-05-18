import { RiskType } from '@shared/model/risk/risk-type.enum';
import { WarningLevel } from '@shared/model/warning/warning-level.enum';

export class AccountRiskModel {
  id!: number;
  accountId!: number;
  sourceRiskId!: number | null;
  sourceVersion!: number | null;
  notificationTemplateId!: number | null;
  name!: string | null;
  description!: string | null;
  riskType!: RiskType;
  ruleJson!: Record<string, unknown>;
  level!: WarningLevel;
  priority!: number;
  isActive!: boolean;
  isNotificationEnabled!: boolean;
  configJson!: Record<string, unknown> | null;
  createdAt!: Date;
  updatedAt!: Date;
}
