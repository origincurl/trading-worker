// Wire-format request for Kiwoom stock master list (ka10099).
// Internal to platforms/kiwoom.
//
// mrkt_tp is inconsistent across Kiwoom examples. The official mobile guide
// documents 001/101, while some wrappers and mock paths still accept 0/10.
// The vendor tries both shapes per market.
export interface GetStockMasterListRequestContract {
  readonly mrkt_tp: string;
}
