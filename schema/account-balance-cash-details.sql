-- Account balance cash/settlement detail snapshot.
-- Apply before deploying worker/BE versions that read account_balances.cash_details.

ALTER TABLE account_balances
  ADD COLUMN IF NOT EXISTS cash_details jsonb;
