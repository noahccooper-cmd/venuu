-- ============================================================================
-- 00002_drop_cover_price.sql
-- Drops the legacy `cover_price` column from venues.
-- Verified 0 rows populated in this column (cover_charge is the source
-- of truth, 228 rows populated).
-- ============================================================================

BEGIN;

-- Drop the legacy column. If any code still references it, TypeScript
-- compilation will fail after the schema types are regenerated, which
-- is the correct behavior — we want loud failure, not silent drift.
ALTER TABLE public.venues DROP COLUMN IF EXISTS cover_price;

COMMIT;

-- ============================================================================
-- Verification — run separately after commit:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'venues'
-- ORDER BY ordinal_position;
-- ============================================================================
