// Wire-format request body for Kiwoom account balance query.
// Kept internal to this vendor folder — must never leak past
// vendors/kiwoom (architecture.md §6 contract rule).
export interface GetAccountBalanceRequestContract {
  readonly acntNo: string;
  readonly qry_tp: '1';
}
