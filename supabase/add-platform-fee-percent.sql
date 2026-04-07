-- Variable platform fee per cover config
-- Bars default 8%, fraternities 12%
ALTER TABLE cover_configs ADD COLUMN IF NOT EXISTS platform_fee_percent numeric DEFAULT 0.08;
