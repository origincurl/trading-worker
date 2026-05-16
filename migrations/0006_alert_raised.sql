-- Phase 9 — detector alerts. alert_id is worker-generated ULID; the
-- unique constraint guards against double-write on storm. Phase 9.x
-- adds ack / close columns when the operator UI lands.

CREATE TABLE IF NOT EXISTS alert_raised (
  id                  BIGSERIAL PRIMARY KEY,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  alert_id            VARCHAR(64)  NOT NULL,
  category            VARCHAR(64)  NOT NULL,
  severity            VARCHAR(16)  NOT NULL,
  subject             VARCHAR(256) NOT NULL,
  message             TEXT         NOT NULL,
  metadata            JSONB,
  raised_at           TIMESTAMPTZ  NOT NULL,
  worker_instance_id  VARCHAR(128) NOT NULL,

  CONSTRAINT uq_alert_raised_alert_id UNIQUE (alert_id)
);

CREATE INDEX IF NOT EXISTS ix_alert_raised_category_raised_at
  ON alert_raised (category, raised_at DESC);
