-- Phase 6.6 — 1m candles aggregated from realtime ticks + chart backfill.
-- PK on (provider, market_env, symbol, bucket_start) for idempotent upsert.
-- data_source carries 'realtime' or 'backfill'; the worker repository never
-- lets a backfill overwrite a realtime row for the same bucket.

CREATE TABLE IF NOT EXISTS candle_1m (
  id              BIGSERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  provider        VARCHAR(32)  NOT NULL,
  market_env      VARCHAR(16)  NOT NULL,
  symbol          VARCHAR(32)  NOT NULL,
  market          VARCHAR(16),
  interval_type   VARCHAR(8)   NOT NULL,

  bucket_start    TIMESTAMPTZ  NOT NULL,
  bucket_end      TIMESTAMPTZ  NOT NULL,

  open            NUMERIC(18,4) NOT NULL,
  high            NUMERIC(18,4) NOT NULL,
  low             NUMERIC(18,4) NOT NULL,
  close           NUMERIC(18,4) NOT NULL,
  volume          NUMERIC(24,4) NOT NULL,
  tick_count      INTEGER       NOT NULL,

  first_source_ts TIMESTAMPTZ  NOT NULL,
  last_source_ts  TIMESTAMPTZ  NOT NULL,

  cum_vol_first   NUMERIC(24,4),
  cum_vol_last    NUMERIC(24,4),
  cum_vol_anomalies INTEGER    NOT NULL DEFAULT 0,

  data_source     VARCHAR(16)  NOT NULL,

  CONSTRAINT uq_candle_1m_bucket UNIQUE (provider, market_env, symbol, bucket_start)
);

CREATE INDEX IF NOT EXISTS ix_candle_1m_symbol_bucket
  ON candle_1m (symbol, bucket_start DESC);
