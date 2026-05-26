export interface CancelOrderResponseContract {
  readonly acntNo?: string;
  readonly ordNo?: string;
  readonly stkCd?: string;
  readonly ordTp?: string;
  readonly ordSide?: string;
  readonly qty?: string;
  readonly prc?: string;
  readonly clOrdId?: string;
  readonly ordStatCd?: string;
  readonly acceptedAt?: string;
  readonly ord_no?: string;
  readonly base_orig_ord_no?: string;
  readonly cncl_qty?: string;
  readonly return_msg?: string;
}
