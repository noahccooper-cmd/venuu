-- Add security fee percent to cover_configs for three-way split
-- Default 0 (no security cut). Set to 0.02 (2%) for Shield-managed venues.
ALTER TABLE cover_configs ADD COLUMN IF NOT EXISTS security_fee_percent numeric DEFAULT 0;

-- Add security_fee column to cover_purchases for tracking
ALTER TABLE cover_purchases ADD COLUMN IF NOT EXISTS security_fee integer DEFAULT 0;
