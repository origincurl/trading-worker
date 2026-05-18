import { DecisionStatus } from './decision-status.enum';
import { DecisionType } from './decision-type.enum';

export class DecisionModel {
  id!: number;
  accountId!: number;
  accountStrategyId!: number;
  strategyId!: number;
  stockId!: number | null;
  decisionType!: DecisionType;
  status!: DecisionStatus;
  reason!: string | null;
  score!: string | null;
  quantity!: string | null;
  price!: string | null;
  amount!: string | null;
  indicatorSnapshot!: Record<string, unknown> | null;
  decisionData!: Record<string, unknown> | null;
  decidedAt!: Date;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;
}
