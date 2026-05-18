import type { AccountBalanceModel } from './account-balance.model';

export const ACCOUNT_BALANCE_REPOSITORY = Symbol('ACCOUNT_BALANCE_REPOSITORY');

export interface UpsertAccountBalanceInput {
  readonly accountExternalId: string;
  readonly brokerage: string;
  readonly marketEnv: 'mock' | 'production';
  readonly currency: string | null;
  readonly cashBalance: number;
  readonly availableCash: number | null;
  readonly totalAsset: number | null;
  readonly syncedAt: Date;
}

export interface AccountBalanceRepository {
  upsert(input: UpsertAccountBalanceInput): Promise<AccountBalanceModel>;
  findByAccount(
    accountExternalId: string,
    brokerage: string,
    marketEnv: 'mock' | 'production',
  ): Promise<AccountBalanceModel | null>;
}
