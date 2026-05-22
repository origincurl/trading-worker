// Wire-format request body for Kiwoom chart candle queries.
// Kept internal to this vendor folder — must never leak past
// platforms/kiwoom (architecture.md §6 contract rule).
//
// Two variants share the same shape; only the optional fields differ
// between minute (ka10080) and daily (ka10081) endpoints.
export interface FetchChartCandlesRequestContract {
  readonly stk_cd: string;
  // YYYYMMDD anchor — Kiwoom returns candles working backward from this date.
  readonly base_dt: string;
  // Minute interval bucket. '1', '3', '5', '10', '15', '30', '45', '60'.
  // TODO(kiwoom-spec): confirm field name is `tic_scope` for ka10080;
  // some Kiwoom docs show `tic_scope` in snake_case while others use
  // `ticScope`. Mock-environment probe will tell us which one returns.
  readonly tic_scope?: string;
  // 0=원주가, 1=수정주가 반영. Only meaningful for daily (ka10081).
  readonly upd_stkpc_tp?: string;
}
