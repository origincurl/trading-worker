// Wire-format response for Kiwoom stock master list (ka10099).
// Internal to platforms/kiwoom.
//
// TODO(kiwoom-spec): Kiwoom's master list response key has several
// candidates in their REST docs (`list`, `stk_lst`, `mst_lst`). We accept
// multiple shapes and the vendor code picks whichever array is present.
export interface KiwoomStockMasterRowContract {
  // Stock code (6-digit). Kiwoom field names: `code` / `stkCd` / `stk_cd`.
  readonly code?: string;
  readonly stkCd?: string;
  readonly stk_cd?: string;
  // Korean name. Kiwoom field names: `name` / `stkNm` / `stk_nm`.
  readonly name?: string;
  readonly stkNm?: string;
  readonly stk_nm?: string;
  // English name (optional, not present on every market).
  readonly engName?: string;
  readonly eng_name?: string;
  // ISIN / standard code. Kiwoom field names vary.
  readonly isin?: string;
  readonly isinCd?: string;
  readonly isin_cd?: string;
  // Currency. Korea exchanges are always KRW so this is rarely returned.
  readonly currency?: string;
}

export interface GetStockMasterListResponseContract {
  readonly return_code?: number | string;
  readonly return_msg?: string;
  readonly list?: ReadonlyArray<KiwoomStockMasterRowContract>;
  readonly stk_lst?: ReadonlyArray<KiwoomStockMasterRowContract>;
  readonly mst_lst?: ReadonlyArray<KiwoomStockMasterRowContract>;
}
