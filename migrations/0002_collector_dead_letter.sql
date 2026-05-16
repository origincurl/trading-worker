-- Phase 6.9 — non-fatal collector anomalies (parse warnings, dead-letters,
-- candle-builder rejections). Retention is 7 days; operator cron prunes
-- rows older than created_at < now() - interval '7 days'.

CREATE TABLE IF NOT EXISTS collector_dead_letter (
  id                BIGSERIAL PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  provider          VARCHAR(32)  NOT NULL,
  market_env        VARCHAR(16)  NOT NULL,
  worker_instance_id VARCHAR(128) NOT NULL,

  reason            VARCHAR(64)  NOT NULL,
  realtime_type     VARCHAR(16),
  symbol            VARCHAR(64),

  received_at       TIMESTAMPTZ  NOT NULL,
  detail            TEXT         NOT NULL,
  parse_warnings    JSONB
);

CREATE INDEX IF NOT EXISTS ix_collector_dl_received_at
  ON collector_dead_letter (received_at DESC);

CREATE INDEX IF NOT EXISTS ix_collector_dl_reason_received
  ON collector_dead_letter (reason, received_at DESC);
