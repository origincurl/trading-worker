import type { AccountRiskEventModel } from '@shared/model/account-risk/account-risk-event.model';

export interface AccountRiskEventRepository {
  findByAccountRiskId(arid: number): Promise<AccountRiskEventModel[]>;
  findCandidate(accountRiskId: number, eventType: string): Promise<AccountRiskEventModel | null>;
}
