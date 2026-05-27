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
  readonly accountId: string;
  readonly currency: string;
  readonly cash: number;
  readonly buyingPower: number;
  readonly equityValue: number;
  readonly cashDetails: AccountBalanceCashDetails;
  readonly snapshotAt: string;
}

export interface PositionModel {
  readonly accountId: string;
  readonly symbol: string;
  readonly quantity: number;
  readonly averagePrice: number;
  readonly marketValue: number;
  readonly unrealizedPnl: number;
  readonly snapshotAt: string;
}
