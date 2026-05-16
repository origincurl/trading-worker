-- Phase 8 — vendor-confirmed order fills. Idempotency anchored on
-- vendor_order_id (vendor's id is the source of truth post-ack).

CREATE TABLE IF NOT EXISTS order_fill (
  id              BIGSERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  provider        VARCHAR(32)  NOT NULL,
  market_env      VARCHAR(16)  NOT NULL,
  account_id      VARCHAR(64)  NOT NULL,
  vendor_order_id VARCHAR(64)  NOT NULL,
  client_order_id VARCHAR(64),
  symbol          VARCHAR(32)  NOT NULL,
  side            VARCHAR(8)   NOT NULL,
  filled_qty      NUMERIC(18,4) NOT NULL,
  filled_price    NUMERIC(18,4) NOT NULL,
  filled_at       TIMESTAMPTZ  NOT NULL,

  CONSTRAINT uq_order_fill_vendor UNIQUE (provider, market_env, vendor_order_id)
);

CREATE INDEX IF NOT EXISTS ix_order_fill_account_filled
  ON order_fill (account_id, filled_at DESC);
