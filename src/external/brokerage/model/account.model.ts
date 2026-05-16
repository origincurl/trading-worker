export interface AccountBalanceModel {
  readonly accountId: string;
  readonly currency: string;
  readonly cash: number;
  readonly buyingPower: number;
  readonly equityValue: number;
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
