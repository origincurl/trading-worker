export interface KiwoomPositionEntryContract {
  readonly stkCd: string;
  readonly qty: string;
  readonly avgPrc: string;
  readonly mktVal: string;
  readonly urlzPnl: string;
}

export interface GetPositionsResponseContract {
  readonly acntNo: string;
  readonly pstnLst: ReadonlyArray<KiwoomPositionEntryContract>;
}
