-- Migrate gas_credit_usage from integer cents to text micro-USD for sub-cent precision on L2s.
-- 1 cent = 10,000 micro-USD. Backfill from existing gas_cost_wei + eth_price_usd.

BEGIN;

-- Add new column
ALTER TABLE gas_credit_usage ADD COLUMN gas_cost_micro_usd text;

-- Backfill: convert gas_cost_usd_cents (integer cents) to micro-USD (cents * 10000)
-- For rows with gas_cost_usd_cents, this is a simple multiplication.
-- For more precision, recompute from gas_cost_wei and eth_price_usd.
UPDATE gas_credit_usage
SET gas_cost_micro_usd = CEIL(
  (gas_cost_wei::numeric / 1e18) * eth_price_usd::numeric * 1000000
)::text;

-- Make column NOT NULL after backfill
ALTER TABLE gas_credit_usage ALTER COLUMN gas_cost_micro_usd SET NOT NULL;

-- Drop old column
ALTER TABLE gas_credit_usage DROP COLUMN gas_cost_usd_cents;

COMMIT;
