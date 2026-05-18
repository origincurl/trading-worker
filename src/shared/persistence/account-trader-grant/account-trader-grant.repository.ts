import type { AccountTraderGrantModel } from '@shared/model/account/account-trader-grant.model';

export interface AccountTraderGrantRepository {
  findActiveByTraderId(traderId: number): Promise<AccountTraderGrantModel[]>;
  findActiveByAccountId(accountId: number): Promise<AccountTraderGrantModel[]>;
}
