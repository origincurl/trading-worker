export interface ModifyOrderResponseContract {
  readonly acntNo: string;
  readonly ordNo: string;
  readonly stkCd: string;
  readonly ordTp: string;
  readonly ordSide: string;
  readonly qty: string;
  readonly prc?: string;
  readonly clOrdId: string;
  readonly ordStatCd: string;
  readonly acceptedAt: string;
}
