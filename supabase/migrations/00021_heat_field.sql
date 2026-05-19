-- ═══════════════════════════════════════════════════════════════
-- 00021_heat_field.sql
--
-- The atmospheric heat field beneath the venue bubbles. A SQL
-- VIEW that joins every active launch-market venue with its
-- latest fused estimate and emits a numeric `heat_weight` in
-- the range [0.0, 1.0+] that the Mapbox heatmap layer uses to
-- size and saturate each point.
--
-- Notes:
--   - Confidence-floored: venues with confidence_pct < 20 emit
--     heat_weight = 0 (matches the front-end 'Unknown' suppression
--     in LiveVenueBubble + the truth-floor pass in 00020).
--   - Views can't join supabase_realtime; the frontend subscribes
--     to headcount_estimates UPDATE/INSERT events and re-fetches
--     this view on a 5s throttle.
--   - 78 active venues at launch — fits comfortably in one query.
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
  -- Heat weight: 0.0 (cold) → 1.0+ (peak Surging).
  -- Below the confidence floor we emit zero so the heatmap sees
  -- the venue but the point has no influence on the gradient.
  CASE
    WHEN h.confidence_pct IS NULL OR h.confidence_pct < 20 THEN 0.0
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

-- The view runs with the privileges of the caller; we want clients
-- (anon + authenticated) to be able to SELECT through it. RLS on
-- the underlying tables (venues, headcount_estimates) already grants
-- public SELECT so the JOIN is allowed.
GRANT SELECT ON public.heat_points TO authenticated, anon;

-- ───────────────────────────────────────────────────────────────
-- Verify
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  view_exists boolean;
  row_count int;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'heat_points'
  ) INTO view_exists;

  IF view_exists THEN
    SELECT COUNT(*) INTO row_count FROM public.heat_points;
  ELSE
    row_count := -1;
  END IF;

  RAISE NOTICE '═══ Migration 00021 complete ═══';
  RAISE NOTICE '  heat_points view: %', CASE WHEN view_exists THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  active rows: %', row_count;
  RAISE NOTICE '  GRANT SELECT to authenticated + anon: applied';
  RAISE NOTICE '';
  RAISE NOTICE 'Frontend reads:';
  RAISE NOTICE '  supabase.from(''heat_points'').select(''*'').eq(''city'', <city>)';
END $$;

COMMIT;
