-- ═══════════════════════════════════════════════════════════════
-- 00022_heat_field_algorithm_only.sql
--
-- Tighten the `heat_points` view so heat_weight is only non-zero
-- for venues whose fusion estimate actually came from an
-- algorithm-run signal source:
--
--   besttime_live      — fresh live busyness from BestTime
--   besttime_forecast  — current-hour BestTime forecast curve
--   bouncer_override   — manual headcount click (last 60 min)
--
-- For venues with baseline_source = category_default or no_data
-- (or no estimate row yet), heat_weight collapses to 0. The row
-- is still emitted so the Mapbox source doesn't blink on minute
-- boundaries while fusion is rewriting estimates — it just
-- contributes nothing to the gradient.
--
-- Frontend already gates `LiveVenueBubble` on the same source
-- set; this brings the heat field into agreement so the two
-- visual languages tell the same truth.
--
-- Idempotent. Wrapped in BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE VIEW public.heat_points AS
SELECT
  v.id           AS venue_id,
  v.name,
  v.city,
  v.lat,
  v.lng,
  v.capacity,
  COALESCE(h.estimate, 0)               AS estimate,
  COALESCE(h.confidence_pct, 0)         AS confidence_pct,
  COALESCE(h.capacity_pct, 0)           AS capacity_pct,
  COALESCE(h.state_label, 'Unknown')    AS state_label,
  -- Heat weight: 0.0 unless the estimate came from a real algorithm
  -- signal. Cold venues (category_default, no_data, no row yet) emit
  -- zero so the heatmap visually agrees with the bubble layer's
  -- "show nothing if we don't know" stance.
  CASE
    WHEN h.venue_id IS NULL THEN 0.0
    WHEN COALESCE(h.source_breakdown ->> 'baseline_source', '') NOT IN
         ('besttime_live', 'besttime_forecast', 'bouncer_override') THEN 0.0
    WHEN h.confidence_pct IS NULL OR h.confidence_pct < 15 THEN 0.0
    WHEN h.state_label = 'Surging' THEN LEAST(1.0, 0.85 + (h.confidence_pct - 50) * 0.003)
    WHEN h.state_label = 'Packed'  THEN 0.70 + LEAST(0.10, h.confidence_pct * 0.001)
    WHEN h.state_label = 'Busy'    THEN 0.50 + LEAST(0.10, h.confidence_pct * 0.001)
    WHEN h.state_label = 'Lively'  THEN 0.30 + LEAST(0.10, h.confidence_pct * 0.001)
    WHEN h.state_label = 'Quiet'   THEN 0.10
    ELSE 0.0
  END AS heat_weight,
  h.computed_at
FROM public.venues v
LEFT JOIN public.headcount_estimates h ON h.venue_id = v.id
WHERE v.is_active = true
  AND v.city IN ('knoxville', 'tampa', 'st_petersburg');

GRANT SELECT ON public.heat_points TO authenticated, anon;

-- ───────────────────────────────────────────────────────────────
-- Verify
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  view_exists boolean;
  total_rows int;
  algo_rows int;
  cold_rows int;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'heat_points'
  ) INTO view_exists;

  IF view_exists THEN
    SELECT COUNT(*) INTO total_rows FROM public.heat_points;
    SELECT COUNT(*) INTO algo_rows FROM public.heat_points WHERE heat_weight > 0;
    cold_rows := total_rows - algo_rows;
  ELSE
    total_rows := -1;
    algo_rows := -1;
    cold_rows := -1;
  END IF;

  RAISE NOTICE '═══ Migration 00022 complete ═══';
  RAISE NOTICE '  heat_points view: %', CASE WHEN view_exists THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  Algorithm-driven rows (heat_weight > 0): %', algo_rows;
  RAISE NOTICE '  Cold rows (weight = 0, suppressed from gradient): %', cold_rows;
  RAISE NOTICE '  Total rows: %', total_rows;
  RAISE NOTICE '';
  RAISE NOTICE 'Bubble + heat field now agree: both show only';
  RAISE NOTICE 'venues with besttime_live / besttime_forecast /';
  RAISE NOTICE 'bouncer_override sources.';
END $$;

COMMIT;
