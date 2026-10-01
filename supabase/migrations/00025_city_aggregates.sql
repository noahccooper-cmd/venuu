-- ═══════════════════════════════════════════════════════════════
-- 00025_city_aggregates.sql
--
-- Per-city rollup of the prediction-engine's headcount_estimates
-- so the globe view can render one dot per launch market and an
-- "X out tonight across N cities" headline. Centers are baked into
-- the view since the venues' raw lat/lng would centroid a downtown-
-- biased point that's fine but inconsistent with the on-app camera
-- targets.
--
-- Aggregation is "active venues only": we exclude Unknown rows and
-- anything with confidence_pct < 20 so the people_out total reflects
-- estimates the engine itself is willing to assert.
--
-- Idempotent. Wrapped in BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

DROP VIEW IF EXISTS public.city_aggregates CASCADE;
CREATE VIEW public.city_aggregates AS
WITH city_centers AS (
  SELECT 'knoxville'      AS city, 35.9606::numeric AS center_lat, -83.9207::numeric AS center_lng
  UNION ALL SELECT 'tampa',         27.9506,         -82.4572
  UNION ALL SELECT 'st_petersburg', 27.7676,         -82.6404
),
joined AS (
  SELECT
    v.city,
    v.id AS venue_id,
    h.estimate,
    h.confidence_pct,
    h.state_label,
    -- "Active" = engine has signal AND is confident enough to label
    (h.state_label IS NOT NULL
       AND h.state_label <> 'Unknown'
       AND COALESCE(h.confidence_pct, 0) >= 20) AS is_active
  FROM public.venues v
  LEFT JOIN public.headcount_estimates h ON h.venue_id = v.id
  WHERE COALESCE(v.is_active, true) = true
    AND v.city IN ('knoxville', 'tampa', 'st_petersburg')
),
rolled AS (
  SELECT
    j.city,
    COUNT(*)                                                                  AS total_venues,
    COUNT(*) FILTER (WHERE j.is_active)                                       AS active_count,
    COALESCE(SUM(j.estimate) FILTER (WHERE j.is_active), 0)::int              AS people_out,
    COUNT(*) FILTER (WHERE j.is_active AND j.state_label = 'Surging')         AS surging_count,
    COUNT(*) FILTER (WHERE j.is_active AND j.state_label = 'Packed')          AS packed_count,
    COUNT(*) FILTER (WHERE j.is_active AND j.state_label = 'Busy')            AS busy_count,
    COUNT(*) FILTER (WHERE j.is_active AND j.state_label = 'Lively')          AS lively_count,
    COUNT(*) FILTER (WHERE j.is_active AND j.state_label = 'Quiet')           AS quiet_count,
    COALESCE(ROUND(AVG(j.confidence_pct) FILTER (WHERE j.is_active))::int, 0) AS avg_confidence
  FROM joined j
  GROUP BY j.city
)
SELECT
  c.city,
  COALESCE(r.total_venues, 0)  AS total_venues,
  COALESCE(r.active_count, 0)  AS active_count,
  COALESCE(r.people_out, 0)    AS people_out,
  CASE
    WHEN COALESCE(r.surging_count, 0) >= 3 THEN 'Surging'
    WHEN COALESCE(r.packed_count, 0) + COALESCE(r.surging_count, 0) >= 3 THEN 'Packed'
    WHEN COALESCE(r.busy_count, 0) + COALESCE(r.packed_count, 0) + COALESCE(r.surging_count, 0) >= 4 THEN 'Busy'
    WHEN COALESCE(r.lively_count, 0) + COALESCE(r.busy_count, 0)
         + COALESCE(r.packed_count, 0) + COALESCE(r.surging_count, 0) >= 4 THEN 'Lively'
    ELSE 'Quiet'
  END                          AS dominant_state,
  c.center_lat,
  c.center_lng,
  COALESCE(r.surging_count, 0) AS surging_count,
  COALESCE(r.packed_count, 0)  AS packed_count,
  COALESCE(r.busy_count, 0)    AS busy_count,
  COALESCE(r.lively_count, 0)  AS lively_count,
  COALESCE(r.quiet_count, 0)   AS quiet_count,
  COALESCE(r.avg_confidence, 0) AS avg_confidence
FROM city_centers c
LEFT JOIN rolled r ON r.city = c.city;

GRANT SELECT ON public.city_aggregates TO authenticated, anon;

-- ───────────────────────────────────────────────────────────────
-- Verify
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
  view_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'city_aggregates'
  ) INTO view_exists;

  RAISE NOTICE '═══ Migration 00025 complete ═══';
  RAISE NOTICE '  city_aggregates view: %', CASE WHEN view_exists THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '';
  RAISE NOTICE '  Snapshot (live values at apply time):';
  IF view_exists THEN
    FOR r IN SELECT * FROM public.city_aggregates ORDER BY city LOOP
      RAISE NOTICE '    % | active=%/% | people_out=% | dominant=% | conf=%',
        rpad(r.city, 16), r.active_count, r.total_venues, r.people_out, r.dominant_state, r.avg_confidence;
    END LOOP;
  END IF;
END $$;

COMMIT;
