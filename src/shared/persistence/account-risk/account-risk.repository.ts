import type { AccountRiskModel } from '@shared/model/account-risk/account-risk.model';

export interface AccountRiskRepository {
  findActiveByAccountId(accountId: number): Promise<AccountRiskModel[]>;
  findAllActive(): Promise<AccountRiskModel[]>;
}
