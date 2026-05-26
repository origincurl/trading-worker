export interface KiwoomPositionEntryContract {
  readonly stkCd?: string;
  readonly stk_cd?: string;
  readonly qty?: string;
  readonly rmnd_qty?: string;
  readonly avgPrc?: string;
  readonly pur_pric?: string;
  readonly cur_prc?: string;
  readonly mktVal?: string;
  readonly evlt_amt?: string;
  readonly urlzPnl?: string;
  readonly evltv_prft?: string;
}

export interface GetPositionsResponseContract {
  readonly acntNo?: string;
  readonly pstnLst?: ReadonlyArray<KiwoomPositionEntryContract>;
  readonly acnt_evlt_remn_indv_tot?: ReadonlyArray<KiwoomPositionEntryContract>;
}
