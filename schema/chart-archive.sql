ALTER TABLE stocks
ADD COLUMN IF NOT EXISTS instrument_type varchar(20) NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'worker_policies_role_enum') THEN
    CREATE TYPE worker_policies_role_enum AS ENUM (
      'COLLECTOR',
      'CALCULATOR',
      'EXECUTOR',
      'DETECTOR',
      'TRACKER',
      'NOTIFIER'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS worker_policies (
  id bigserial PRIMARY KEY,
  role worker_policies_role_enum NOT NULL,
  key varchar(100) NOT NULL,
  value_json json NOT NULL,
  description text NULL,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamp NOT NULL DEFAULT NOW(),
  updated_at timestamp NOT NULL DEFAULT NOW(),
  deleted_at timestamp NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_policies_role_key_active
  ON worker_policies (role, key)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS chart_archive_manifests (
  id bigserial PRIMARY KEY,
  provider varchar(32) NOT NULL,
  market_env varchar(20) NOT NULL,
  market varchar(16) NOT NULL DEFAULT 'kr',
  symbol varchar(50) NOT NULL,
  stock_id bigint NULL,
  timeframe varchar(8) NOT NULL,
  partition_key varchar(16) NOT NULL,
  status varchar(16) NOT NULL,
  s3_key text NULL,
  sidecar_s3_key text NULL,
  expected_row_count integer NOT NULL,
  actual_row_count integer NOT NULL,
  coverage_ratio double precision NOT NULL,
  object_checksum varchar(64) NULL,
  content_checksum varchar(64) NULL,
  source_checksum varchar(64) NULL,
  source_run_id uuid NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  data_revision integer NOT NULL DEFAULT 1,
  archived_at timestamptz NOT NULL,
  last_modified_at timestamptz NOT NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_chart_archive_manifests_partition
    UNIQUE (provider, market_env, symbol, timeframe, partition_key)
);

CREATE INDEX IF NOT EXISTS ix_chart_archive_manifests_status
  ON chart_archive_manifests (status, archived_at DESC);

CREATE INDEX IF NOT EXISTS ix_chart_archive_manifests_partition_lookup
  ON chart_archive_manifests (provider, market_env, partition_key, timeframe);

CREATE TABLE IF NOT EXISTS chart_archive_tasks (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL,
  provider varchar(32) NOT NULL,
  market_env varchar(20) NOT NULL,
  symbol varchar(50) NOT NULL,
  timeframe varchar(8) NOT NULL,
  partition_key varchar(16) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_chart_archive_tasks_run_partition
    UNIQUE (run_id, provider, market_env, symbol, timeframe, partition_key)
);

CREATE INDEX IF NOT EXISTS ix_chart_archive_tasks_run_status
  ON chart_archive_tasks (run_id, status);

CREATE TABLE IF NOT EXISTS chart_archive_task_audits (
  id bigserial PRIMARY KEY,
  run_id uuid NULL,
  task_id bigint NULL,
  manifest_id bigint NULL,
  action varchar(40) NOT NULL,
  actor varchar(120) NULL,
  prev_status varchar(16) NULL,
  new_status varchar(16) NULL,
  reason text NULL,
  metadata_json jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_chart_archive_task_audits_run
  ON chart_archive_task_audits (run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS krx_calendar (
  trade_date date PRIMARY KEY,
  is_trading_day boolean NOT NULL,
  session_open_kst varchar(5) NULL,
  session_close_kst varchar(5) NULL,
  is_partial_day boolean NOT NULL DEFAULT false,
  source varchar(32) NOT NULL,
  holiday_name varchar(120) NULL,
  notes text NULL,
  revision integer NOT NULL DEFAULT 1,
  source_updated_at timestamptz NOT NULL,
  last_synced_at timestamptz NOT NULL DEFAULT NOW(),
  updated_by varchar(120) NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS krx_calendar_sync_runs (
  id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NULL,
  source varchar(32) NOT NULL,
  status varchar(16) NOT NULL,
  affected_rows integer NOT NULL DEFAULT 0,
  revision integer NOT NULL DEFAULT 1,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chart_archive_backfill_requests (
  id bigserial PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  provider varchar(32) NOT NULL,
  market_env varchar(20) NOT NULL,
  symbol varchar(50) NOT NULL,
  from_trade_date date NOT NULL,
  to_trade_date date NOT NULL,
  priority varchar(8) NOT NULL DEFAULT 'P4',
  status varchar(16) NOT NULL DEFAULT 'PENDING',
  reason text NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_chart_archive_backfill_requests_status
  ON chart_archive_backfill_requests (status, priority, created_at);

INSERT INTO worker_policies (role, key, value_json, description, is_active, version)
VALUES (
  'COLLECTOR',
  'chart_archive_db_fallback_enabled',
  '{"value": true}',
  'Phase A chart archive reader fallback to existing market_candles.',
  true,
  1
)
ON CONFLICT (role, key) WHERE deleted_at IS NULL DO NOTHING;
