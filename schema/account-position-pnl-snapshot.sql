ALTER TABLE account_positions
  ADD COLUMN IF NOT EXISTS current_price numeric(20, 6) NULL,
  ADD COLUMN IF NOT EXISTS market_value numeric(24, 6) NULL,
  ADD COLUMN IF NOT EXISTS unrealized_pnl numeric(24, 6) NULL;
