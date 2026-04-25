-- ============================================================================
-- 00003_drop_special_column.sql
-- Drops the legacy `special` column from venues.
-- tonight_special is the canonical column (read by all patron-side consumers).
-- Portal writes now go through the set-venue-special edge function which
-- writes to tonight_special. The `special` column had 7 stale rows from a
-- broken path that never displayed to patrons.
-- ============================================================================

BEGIN;
ALTER TABLE public.venues DROP COLUMN IF EXISTS special;
COMMIT;
