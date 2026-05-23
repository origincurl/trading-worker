export type KiwoomDomesticExchangeType = 'KRX' | 'NXT' | 'SOR';

// Wire-format request body for Kiwoom kt00018 account positions query.
// qry_tp='1' is the aggregated per-symbol mode. account_positions has a
// per-symbol unique key, so qry_tp='2' lot-level rows would break the upsert.
export interface GetPositionsRequestContract {
  readonly acntNo: string;
  readonly qry_tp: '1';
  readonly dmst_stex_tp: KiwoomDomesticExchangeType;
}
