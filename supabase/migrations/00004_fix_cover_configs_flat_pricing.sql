-- ============================================================================
-- 00004_fix_cover_configs_flat_pricing.sql
-- Drops a leftover check constraint that blocks flat-mode cover pricing.
--
-- cover_configs had two constraints on the same column pair:
--   cover_configs_cap_price_check: (cap_price >= base_price)   [correct]
--   cover_configs_check:           (cap_price >  base_price)   [buggy]
--
-- The stricter > constraint rejected every flat-mode insert where
-- cap_price equals base_price by definition. Removing it; the >= check
-- remains as the correct constraint.
-- ============================================================================

BEGIN;
ALTER TABLE public.cover_configs DROP CONSTRAINT IF EXISTS cover_configs_check;
COMMIT;

-- ============================================================================
-- Verification — run separately after commit:
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid = 'public.cover_configs'::regclass AND contype = 'c';
-- Expect three rows: cover_configs_cap_price_check, cover_configs_capacity_check, cover_configs_check1
-- ============================================================================
