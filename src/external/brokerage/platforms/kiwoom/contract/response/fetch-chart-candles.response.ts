// Wire-format response for Kiwoom chart candle queries.
// Internal to platforms/kiwoom.
//
// Kiwoom returns rows nested under one of several array keys depending on
// apiId. We model both known variants and the vendor code picks whichever
// is populated. TODO(kiwoom-spec): the exact key names below are best-
// effort against public Kiwoom docs — wire them in and adjust once a real
// mock-env response is observed.
export interface KiwoomChartCandleRowContract {
  // YYYYMMDD or YYYYMMDDHHmmss depending on intervalType.
  readonly dt?: string;
  readonly cntr_tm?: string;
  // Open / high / low / close. Kiwoom typically returns strings for prices.
  readonly op?: string;
  readonly open_pric?: string;
  readonly hg?: string;
  readonly high_pric?: string;
  readonly lw?: string;
  readonly low_pric?: string;
  readonly cp?: string;
  readonly cur_prc?: string;
  // Volume. tradeVolume / trd_qty / cntr_qty depending on apiId.
  readonly tradeVolume?: string;
  readonly trde_qty?: string;
  readonly trd_qty?: string;
  readonly cntr_qty?: string;
}

export interface FetchChartCandlesResponseContract {
  readonly return_code?: number | string;
  readonly return_msg?: string;
  // ka10080 (minute)
  readonly stk_min_pole_chart_qry?: ReadonlyArray<KiwoomChartCandleRowContract>;
  // ka10081 (daily)
  readonly stk_dt_pole_chart_qry?: ReadonlyArray<KiwoomChartCandleRowContract>;
}
