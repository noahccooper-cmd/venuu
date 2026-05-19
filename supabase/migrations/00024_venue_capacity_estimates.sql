-- ═══════════════════════════════════════════════════════════════
-- 00024_venue_capacity_estimates.sql
--
-- TEMPORARY backfill for venue capacities. The Tampa + St. Pete
-- seed in 00008 inserted rows without a `capacity` value, which
-- means compute_venue_estimate's Step 4 sets capacity_pct = NULL,
-- which means LiveVenueBubble.getCapacityText returns null and the
-- third line of the Signature Display never renders.
--
-- This migration assigns educated-guess capacities by category so
-- the third line shows something meaningful. Real numbers should
-- come from venue partners at onboarding; until then these
-- defaults give the map visual fidelity.
--
-- Defaults align with the categories present in the seeds:
--   bar         → 150   (the launch baseline)
--   cocktail    → 120   (smaller intimate rooms)
--   lounge      → 140
--   dive        → 130
--   club        → 300
--   nightclub   → 300
--   brewery     → 200
--   restaurant  → 100
--   rooftop     → 180
--   venue       → 350   (event halls like Jannus Live)
--   fraternity  → 250   (kept even though fusion excludes them;
--                        future visual layers may use it)
--
-- Idempotent. Only touches rows where capacity is NULL — does NOT
-- overwrite venue-partner-supplied values that already exist.
--
-- Scoped to launch markets only; SEC archive cities are left alone.
--
-- Wrapped in BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.venues
SET capacity = CASE category
  WHEN 'bar'         THEN 150
  WHEN 'cocktail'    THEN 120
  WHEN 'lounge'      THEN 140
  WHEN 'dive'        THEN 130
  WHEN 'club'        THEN 300
  WHEN 'nightclub'   THEN 300
  WHEN 'brewery'     THEN 200
  WHEN 'restaurant'  THEN 100
  WHEN 'rooftop'     THEN 180
  WHEN 'venue'       THEN 350
  WHEN 'fraternity'  THEN 250
  ELSE 150
END
WHERE capacity IS NULL
  AND COALESCE(is_active, true) = true
  AND city IN ('knoxville', 'tampa', 'st_petersburg');

DO $$
DECLARE
  updated_count int;
  remaining_null int;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  SELECT COUNT(*) INTO remaining_null
  FROM public.venues
  WHERE capacity IS NULL
    AND COALESCE(is_active, true) = true
    AND city IN ('knoxville', 'tampa', 'st_petersburg');

  RAISE NOTICE '═══ Migration 00024 complete ═══';
  RAISE NOTICE '  Capacities backfilled: % venues', updated_count;
  RAISE NOTICE '  Active launch-market venues still NULL: %', remaining_null;
  RAISE NOTICE '';
  RAISE NOTICE 'Next fusion cycle (within 60s) will recompute';
  RAISE NOTICE 'capacity_pct for affected venues; the third line of';
  RAISE NOTICE 'the Signature Display lights up on the next realtime tick.';
END $$;

COMMIT;
