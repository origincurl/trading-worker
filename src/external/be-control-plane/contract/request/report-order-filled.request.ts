export interface ReportOrderFilledRequestContract {
  readonly vendorOrderId: string;
  readonly clientOrderId: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly filledQty: number;
  readonly filledPrice: number;
  readonly filledAt: string;
}
