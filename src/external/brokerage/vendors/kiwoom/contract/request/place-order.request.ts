export interface PlaceOrderRequestContract {
  readonly acntNo: string;
  readonly stkCd: string;
  readonly ordTp: string;
  readonly ordSide: string;
  readonly qty: number;
  readonly prc?: number;
  readonly clOrdId: string;
}
