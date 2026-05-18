import type { Brokerage } from '@shared/model/account/brokerage.enum';
import type { MarketEnv } from '@shared/model/api-credential/market-env.enum';
import type { AccountModel } from '@shared/model/account/account.model';

export interface AccountRepository {
  findById(id: number): Promise<AccountModel | null>;
  // External key path: (brokerage, marketEnv, accountExternalId).
  // marketEnv lives on account_credentials, not accounts — the impl
  // resolves the join.
  findByExternalKey(
    brokerage: Brokerage,
    marketEnv: MarketEnv,
    accountExternalId: string,
  ): Promise<AccountModel | null>;
  findActiveAccounts(): Promise<AccountModel[]>;
}
