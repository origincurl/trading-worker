export interface CancelOrderRequestContract {
  readonly acntNo?: string;
  readonly orig_ord_no: string;
  readonly stk_cd: string;
  readonly cncl_qty: string;
  readonly dmst_stex_tp: string;
}
