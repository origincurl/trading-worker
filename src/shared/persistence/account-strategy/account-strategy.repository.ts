import type { AccountStrategyModel } from '@shared/model/account-strategy/account-strategy.model';

export interface AccountStrategyRepository {
  findActiveByAccountId(accountId: number): Promise<AccountStrategyModel[]>;
  // Executor scheduler polls every active strategy across all accounts.
  findAllActive(): Promise<AccountStrategyModel[]>;
}
