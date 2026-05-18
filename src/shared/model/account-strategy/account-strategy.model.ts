import { StrategyType } from '@shared/model/strategy/strategy-type.enum';

export class AccountStrategyModel {
  id!: number;
  accountId!: number;
  sourceStrategyId!: number | null;
  sourceVersion!: number | null;
  notificationTemplateId!: number | null;
  name!: string | null;
  description!: string | null;
  strategyType!: StrategyType;
  ruleJson!: Record<string, unknown>;
  priority!: number;
  isActive!: boolean;
  isAutoOrderEnabled!: boolean;
  isNotificationEnabled!: boolean;
  investmentRatio!: string | null;
  configJson!: Record<string, unknown> | null;
  createdAt!: Date;
  updatedAt!: Date;
}
