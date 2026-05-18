import type { DecisionStatus } from '@shared/model/decision/decision-status.enum';
import type { DecisionType } from '@shared/model/decision/decision-type.enum';
import type { DecisionModel } from '@shared/model/decision/decision.model';

export interface CreateDecisionInput {
  readonly accountId: number;
  readonly accountStrategyId: number;
  readonly strategyId: number;
  readonly stockId: number | null;
  readonly decisionType: DecisionType;
  readonly status: DecisionStatus;
  readonly reason: string | null;
  readonly score: string | null;
  readonly quantity: string | null;
  readonly price: string | null;
  readonly amount: string | null;
  readonly indicatorSnapshot: Record<string, unknown> | null;
  readonly decisionData: Record<string, unknown> | null;
  readonly decidedAt: Date;
}

export interface DecisionRepository {
  createDecision(input: CreateDecisionInput): Promise<DecisionModel>;
}
