export interface PlaceOrderRequestContract {
  readonly acntNo?: string;
  readonly stk_cd: string;
  readonly dmst_stex_tp: string;
  readonly ord_qty: string;
  readonly ord_uv: string;
  readonly trde_tp: string;
  readonly cond_uv?: string;
  readonly clOrdId?: string;
}
