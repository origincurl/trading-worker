-- Phase 7 — technical indicators computed off `candle_1m`.
-- PK on (provider, market_env, symbol, bucket_start, indicator_type, window_size)
-- so replays from Streams remain idempotent.

CREATE TABLE IF NOT EXISTS indicator_1m (
  id              BIGSERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  provider        VARCHAR(32)  NOT NULL,
  market_env      VARCHAR(16)  NOT NULL,
  symbol          VARCHAR(32)  NOT NULL,
  bucket_start    TIMESTAMPTZ  NOT NULL,
  indicator_type  VARCHAR(16)  NOT NULL,
  window_size     INTEGER      NOT NULL,
  value           NUMERIC(18,6),

  CONSTRAINT uq_indicator_1m UNIQUE
    (provider, market_env, symbol, bucket_start, indicator_type, window_size)
);

CREATE INDEX IF NOT EXISTS ix_indicator_1m_symbol_type_bucket
  ON indicator_1m (symbol, indicator_type, bucket_start DESC);
