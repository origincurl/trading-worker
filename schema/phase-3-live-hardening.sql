CREATE TABLE IF NOT EXISTS unmatched_order_fills (
  id bigserial PRIMARY KEY,
  external_fill_id varchar(255) NOT NULL,
  provider varchar(32) NOT NULL,
  market_env varchar(16) NOT NULL,
  account_id varchar(64) NOT NULL,
  vendor_order_id varchar(64) NULL,
  client_order_id varchar(100) NULL,
  symbol varchar(32) NOT NULL,
  reason varchar(32) NOT NULL,
  status varchar(24) NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  next_retry_at timestamptz NULL,
  resolved_order_id bigint NULL,
  resolved_at timestamptz NULL,
  last_error text NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_unmatched_order_fills_external_fill_id
  ON unmatched_order_fills (external_fill_id);

CREATE INDEX IF NOT EXISTS ix_unmatched_order_fills_retry
  ON unmatched_order_fills (status, next_retry_at);

CREATE TABLE IF NOT EXISTS position_books (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL,
  stock_id bigint NOT NULL,
  source_type varchar(16) NOT NULL,
  account_strategy_id bigint NULL,
  strategy_id bigint NULL,
  requested_by_user_id bigint NULL,
  quantity numeric(24, 8) NOT NULL DEFAULT 0,
  average_price numeric(20, 6) NOT NULL DEFAULT 0,
  cost_amount numeric(24, 6) NOT NULL DEFAULT 0,
  realized_amount numeric(24, 6) NOT NULL DEFAULT 0,
  last_fill_id bigint NULL,
  last_filled_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_position_books_strategy_scope
  ON position_books (account_id, stock_id, account_strategy_id)
  WHERE source_type = 'STRATEGY' AND account_strategy_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_position_books_manual_scope
  ON position_books (account_id, stock_id, requested_by_user_id)
  WHERE source_type = 'MANUAL' AND requested_by_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_position_books_manual_account_scope
  ON position_books (account_id, stock_id)
  WHERE source_type = 'MANUAL' AND requested_by_user_id IS NULL;

CREATE INDEX IF NOT EXISTS ix_position_books_account_stock
  ON position_books (account_id, stock_id);

ALTER TABLE order_fill
  ALTER COLUMN client_order_id TYPE varchar(100),
  ADD COLUMN IF NOT EXISTS live_published_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS stream_published_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS publish_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS publish_claimed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS next_publish_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_publish_error text NULL;

CREATE INDEX IF NOT EXISTS ix_order_fill_outbox
  ON order_fill (next_publish_at, publish_claimed_at, created_at)
  WHERE live_published_at IS NULL OR stream_published_at IS NULL;
