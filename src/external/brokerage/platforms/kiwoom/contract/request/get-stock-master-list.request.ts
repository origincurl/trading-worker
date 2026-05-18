// Wire-format request for Kiwoom stock master list (ka10099).
// Internal to platforms/kiwoom.
//
// mrktTp: '0' KOSPI / '10' KOSDAQ / '8' KONEX.
// TODO(kiwoom-spec): confirm exact codes; '8' for KONEX may instead be
// '3' depending on Kiwoom REST version. Adjust once a probe call works.
export interface GetStockMasterListRequestContract {
  readonly mrktTp: string;
}
