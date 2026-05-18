import type { AccountStrategyEventModel } from '@shared/model/account-strategy/account-strategy-event.model';

export interface AccountStrategyEventRepository {
  findByAccountStrategyId(asid: number): Promise<AccountStrategyEventModel[]>;
  // Candidate = enabled row matching (accountStrategyId, eventType). Used
  // by executor/notifier to check whether a given event_type is wired up
  // for an account strategy without scanning all rows.
  findCandidate(
    accountStrategyId: number,
    eventType: string,
  ): Promise<AccountStrategyEventModel | null>;
}
