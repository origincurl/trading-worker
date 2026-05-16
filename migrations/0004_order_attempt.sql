-- Phase 8 — every executor's attempt to place an order. status transitions:
-- pending → accepted | rejected | failed. Idempotency is anchored on
-- (provider, market_env, client_order_id) — the worker generates
-- client_order_id, so the same signalId never produces two pending rows.

CREATE TABLE IF NOT EXISTS order_attempt (
  id              BIGSERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  provider        VARCHAR(32)  NOT NULL,
  market_env      VARCHAR(16)  NOT NULL,
  account_id      VARCHAR(64)  NOT NULL,
  client_order_id VARCHAR(64)  NOT NULL,
  signal_id       VARCHAR(64)  NOT NULL,
  symbol          VARCHAR(32)  NOT NULL,
  side            VARCHAR(8)   NOT NULL,
  order_type      VARCHAR(16)  NOT NULL,
  quantity        NUMERIC(18,4) NOT NULL,
  price           NUMERIC(18,4),
  status          VARCHAR(16)  NOT NULL,
  vendor_order_id VARCHAR(64),
  error_code      VARCHAR(64),
  error_message   TEXT,

  CONSTRAINT uq_order_attempt_client UNIQUE (provider, market_env, client_order_id)
);

CREATE INDEX IF NOT EXISTS ix_order_attempt_account_created
  ON order_attempt (account_id, created_at DESC);
