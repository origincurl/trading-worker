CREATE TABLE IF NOT EXISTS order_fill (
  id bigserial PRIMARY KEY,
  provider varchar(32) NOT NULL,
  market_env varchar(16) NOT NULL,
  account_id varchar(64) NOT NULL,
  vendor_order_id varchar(64) NOT NULL,
  external_fill_id varchar(255) NOT NULL,
  client_order_id varchar(100) NULL,
  symbol varchar(32) NOT NULL,
  side varchar(8) NOT NULL,
  filled_qty numeric(18, 4) NOT NULL,
  filled_price numeric(18, 4) NOT NULL,
  filled_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF to_regclass('public.order_fill') IS NOT NULL THEN
    ALTER TABLE order_fill
      ADD COLUMN IF NOT EXISTS external_fill_id varchar(255);

    UPDATE order_fill
    SET external_fill_id =
      provider || ':' || market_env || ':' || account_id || ':' || vendor_order_id || ':' ||
      to_char(filled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ':' ||
      filled_qty::text || ':' || filled_price::text
    WHERE external_fill_id IS NULL;

    ALTER TABLE order_fill
      ALTER COLUMN external_fill_id SET NOT NULL;

    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'uq_order_fill_vendor'
    ) THEN
      ALTER TABLE order_fill DROP CONSTRAINT uq_order_fill_vendor;
    END IF;

  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_order_fill_execution
  ON order_fill (provider, market_env, external_fill_id);

CREATE INDEX IF NOT EXISTS ix_order_fill_account_filled
  ON order_fill (account_id, filled_at);

ALTER TABLE order_fill
  ALTER COLUMN client_order_id TYPE varchar(100);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fills_external_fill_id
  ON fills (external_fill_id)
  WHERE external_fill_id IS NOT NULL;
