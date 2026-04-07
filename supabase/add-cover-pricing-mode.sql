-- Add pricing_mode column to cover_configs
ALTER TABLE cover_configs ADD COLUMN IF NOT EXISTS pricing_mode text DEFAULT 'dynamic' CHECK (pricing_mode IN ('dynamic', 'flat'));
