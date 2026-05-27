// Internal worker model for account balance snapshots. Stays separate
// from external/brokerage/model/account.model.ts (which is the vendor
// contract shape) so the persistence layer can evolve independently of
// gateway shapes.

// brokerage / marketEnv: kept as string unions for now (no shared enum
// exists in the worker). Mirror the convention used by candle/order
// entities. Phase 9 may promote to a shared enum once BE-side wiring is
// finalised.
export type AccountBalanceBrokerage = string;
export type AccountBalanceMarketEnv = 'mock' | 'production';

export interface AccountBalanceCashDetails {
  readonly withdrawalAvailable: number | null;
  readonly orderAvailable: number | null;
  readonly d1EstimatedDeposit: number | null;
  readonly d1SettlementAmount: number | null;
  readonly d1BuySettlementAmount: number | null;
  readonly d1SellSettlementAmount: number | null;
  readonly d1RepaymentRequired: number | null;
  readonly d1WithdrawalAvailable: number | null;
  readonly d2EstimatedDeposit: number | null;
  readonly d2SettlementAmount: number | null;
  readonly d2BuySettlementAmount: number | null;
  readonly d2SellSettlementAmount: number | null;
  readonly d2RepaymentRequired: number | null;
  readonly d2WithdrawalAvailable: number | null;
  readonly receivableCash: number | null;
  readonly receivableCashTotal: number | null;
  readonly substituteValue: number | null;
  readonly remainingSubstituteValue: number | null;
  readonly entrustedSubstituteValue: number | null;
}

export interface AccountBalanceModel {
  readonly accountExternalId: string;
  readonly brokerage: AccountBalanceBrokerage;
  readonly marketEnv: AccountBalanceMarketEnv;
  readonly currency: string | null;
  readonly cashBalance: number;
  readonly availableCash: number | null;
  readonly totalAsset: number | null;
  readonly cashDetails: AccountBalanceCashDetails | null;
  readonly syncedAt: string | null;
}
