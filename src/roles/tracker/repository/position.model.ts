import type {
  AccountBalanceBrokerage,
  AccountBalanceMarketEnv,
} from './account-balance.model';

export interface TrackerPositionModel {
  readonly accountExternalId: string;
  readonly brokerage: AccountBalanceBrokerage;
  readonly marketEnv: AccountBalanceMarketEnv;
  readonly symbol: string;
  readonly quantity: number;
  readonly lockedQuantity: number | null;
  readonly averagePrice: number;
  readonly currentPrice: number | null;
  readonly marketValue: number | null;
  readonly unrealizedPnl: number | null;
  readonly syncedAt: string | null;
}
