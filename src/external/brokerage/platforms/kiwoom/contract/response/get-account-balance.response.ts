export interface GetAccountBalanceResponseContract {
  readonly acntNo?: string;
  readonly entr?: string;
  readonly pymn_alow_amt?: string;
  readonly ord_alow_amt?: string;
  readonly repl_amt?: string;
  readonly remn_repl_evlta?: string;
  readonly trst_remn_repl_evlta?: string;
  readonly ch_uncla?: string;
  readonly ch_uncla_tot?: string;
  readonly d1_entra?: string;
  readonly d1_slby_exct_amt?: string;
  readonly d1_buy_exct_amt?: string;
  readonly d1_sel_exct_amt?: string;
  readonly d1_out_rep_mor?: string;
  readonly d1_pymn_alow_amt?: string;
  readonly d2_entra?: string;
  readonly d2_slby_exct_amt?: string;
  readonly d2_buy_exct_amt?: string;
  readonly d2_sel_exct_amt?: string;
  readonly d2_out_rep_mor?: string;
  readonly d2_pymn_alow_amt?: string;
  readonly return_code?: number;
  readonly return_msg?: string;
}
