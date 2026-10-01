-- ════════════════════════════════════════════════════════════════
-- 00053_vibe_baseline_patches.sql
--
-- Phase A seeded 47 of 49 venues. Two name-pattern misses:
--   - Kern's Food Hall (apostrophe variant)
--   - MacDinton's (apostrophe variant)
--
-- Use ILIKE patterns to match regardless of apostrophe encoding.
-- ════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 5, "wk_peak": 5, "wknd_early": 5, "wknd_peak": 5}'::jsonb
  WHERE city = 'knoxville' AND vibe_hue_baseline IS NULL AND name ILIKE '%Kern%Food%';

UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 8, "wk_peak": 9, "wknd_early": 9, "wknd_peak": 10}'::jsonb
  WHERE city = 'tampa' AND vibe_hue_baseline IS NULL AND name ILIKE '%MacDinton%';

DO $$
DECLARE
  v_remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_remaining
  FROM public.venues
  WHERE is_active = true
    AND city IN ('knoxville', 'tampa', 'st_petersburg')
    AND vibe_hue_baseline IS NULL;

  RAISE NOTICE '─────────────────────────────────────';
  RAISE NOTICE 'VIBE BASELINE PATCH';
  RAISE NOTICE '  Active venues still without baseline: %', v_remaining;
  RAISE NOTICE '─────────────────────────────────────';
END $$;

COMMIT;
