export interface ModifyOrderRequestContract {
  readonly acntNo?: string;
  readonly orig_ord_no: string;
  readonly stk_cd: string;
  readonly dmst_stex_tp: string;
  readonly mdfy_qty: string;
  readonly mdfy_uv: string;
  readonly mdfy_cond_uv?: string;
}
