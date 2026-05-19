BEGIN;

CREATE OR REPLACE VIEW public.city_pulse AS
WITH confident_estimates AS (
  SELECT
    v.city,
    he.delta_pct,
    he.confidence_pct,
    he.state_label,
    he.estimate
  FROM public.headcount_estimates he
  JOIN public.venues v ON v.id = he.venue_id
  WHERE v.is_active = true
    AND v.city IN ('knoxville', 'tampa', 'st_petersburg')
    AND (v.category IS NULL OR v.category NOT IN ('greek', 'fraternity'))
    AND he.confidence_pct >= 35
    AND he.delta_pct IS NOT NULL
    AND he.computed_at >= now() - interval '5 minutes'
)
SELECT
  city,
  COUNT(*) AS venues_with_signal,
  ROUND(AVG(delta_pct), 1) AS avg_delta_pct,
  ROUND(MAX(delta_pct), 1) AS top_riser_delta,
  ROUND(MIN(delta_pct), 1) AS top_faller_delta,
  COUNT(*) FILTER (WHERE state_label = 'Surging') AS surging_count,
  COUNT(*) FILTER (WHERE state_label IN ('Packed', 'Busy')) AS busy_count,
  COUNT(*) FILTER (WHERE state_label = 'Quiet') AS quiet_count,
  now() AS computed_at
FROM confident_estimates
GROUP BY city;

DO $$
BEGIN
  RAISE NOTICE '-----------------------------------';
  RAISE NOTICE 'city_pulse view deployed';
  RAISE NOTICE 'Aggregates confident venue deltas per city';
  RAISE NOTICE '-----------------------------------';
END $$;

COMMIT;
