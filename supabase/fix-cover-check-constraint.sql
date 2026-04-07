-- Fix cover_configs CHECK constraint to allow flat pricing (cap_price = base_price)
-- The original constraint used >, blocking flat mode saves

-- Drop the old constraint (name is auto-generated as cover_configs_cap_price_check)
ALTER TABLE cover_configs DROP CONSTRAINT IF EXISTS cover_configs_cap_price_check;

-- Add the corrected constraint (>= allows flat mode where cap = base)
ALTER TABLE cover_configs ADD CONSTRAINT cover_configs_cap_price_check CHECK (cap_price >= base_price);
