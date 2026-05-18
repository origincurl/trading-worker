export interface ModifyOrderRequestContract {
  readonly acntNo: string;
  readonly ordNo: string;
  readonly qty?: number;
  readonly prc?: number;
}
