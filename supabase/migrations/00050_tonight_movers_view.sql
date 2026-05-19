BEGIN;

CREATE OR REPLACE VIEW public.tonight_movers AS
SELECT
  v.id AS venue_id,
  v.name AS venue_name,
  v.slug AS venue_slug,
  v.city,
  v.lat,
  v.lng,
  v.image_url,
  he.delta_pct,
  he.estimate,
  he.state_label,
  he.confidence_pct,
  he.trend,
  he.trend_rate,
  he.computed_at,
  CASE
    WHEN he.delta_pct >= 30 THEN 'top_riser'
    WHEN he.delta_pct >= 15 THEN 'rising'
    WHEN he.delta_pct <= -30 THEN 'top_faller'
    WHEN he.delta_pct <= -15 THEN 'falling'
    ELSE 'flat'
  END AS movement_tier,
  RANK() OVER (
    PARTITION BY v.city
    ORDER BY he.delta_pct DESC NULLS LAST
  ) AS rank_in_city_desc,
  RANK() OVER (
    PARTITION BY v.city
    ORDER BY he.delta_pct ASC NULLS LAST
  ) AS rank_in_city_asc
FROM public.headcount_estimates he
JOIN public.venues v ON v.id = he.venue_id
WHERE v.is_active = true
  AND v.city IN ('knoxville', 'tampa', 'st_petersburg')
  AND (v.category IS NULL OR v.category NOT IN ('greek', 'fraternity'))
  AND he.confidence_pct >= 35
  AND he.delta_pct IS NOT NULL
  AND he.computed_at >= now() - interval '5 minutes';

DO $$
BEGIN
  RAISE NOTICE '-----------------------------------';
  RAISE NOTICE 'tonight_movers view deployed';
  RAISE NOTICE '-----------------------------------';
END $$;

COMMIT;
