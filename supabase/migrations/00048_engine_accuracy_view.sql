BEGIN;

-- Overall accuracy view -- three time windows, measurable rows only
CREATE OR REPLACE VIEW public.engine_accuracy_overall AS
WITH measurable AS (
  SELECT
    al.match_score,
    al.match_kind,
    al.state_distance,
    al.recorded_at,
    al.predicted_baseline_source,
    v.city
  FROM public.headcount_accuracy_log al
  JOIN public.venues v ON v.id = al.venue_id
  WHERE al.match_kind NOT IN ('unmeasurable')
)
SELECT
  '7_days'::text AS window,
  COUNT(*) AS sample_size,
  ROUND(AVG(match_score) * 100, 1) AS accuracy_pct,
  COUNT(*) FILTER (WHERE match_kind = 'exact') AS exact_matches,
  COUNT(*) FILTER (WHERE match_kind = 'one_step') AS one_step_matches,
  COUNT(*) FILTER (WHERE match_kind = 'miss') AS misses,
  COUNT(*) FILTER (WHERE match_kind = 'unknown_prediction') AS unknown_predictions
FROM measurable
WHERE recorded_at >= now() - interval '7 days'
UNION ALL
SELECT
  '14_days', COUNT(*),
  ROUND(AVG(match_score) * 100, 1),
  COUNT(*) FILTER (WHERE match_kind = 'exact'),
  COUNT(*) FILTER (WHERE match_kind = 'one_step'),
  COUNT(*) FILTER (WHERE match_kind = 'miss'),
  COUNT(*) FILTER (WHERE match_kind = 'unknown_prediction')
FROM measurable
WHERE recorded_at >= now() - interval '14 days'
UNION ALL
SELECT
  '30_days', COUNT(*),
  ROUND(AVG(match_score) * 100, 1),
  COUNT(*) FILTER (WHERE match_kind = 'exact'),
  COUNT(*) FILTER (WHERE match_kind = 'one_step'),
  COUNT(*) FILTER (WHERE match_kind = 'miss'),
  COUNT(*) FILTER (WHERE match_kind = 'unknown_prediction')
FROM measurable
WHERE recorded_at >= now() - interval '30 days';

-- Per-city accuracy view -- for measuring Tampa vs Knoxville vs St Pete
CREATE OR REPLACE VIEW public.engine_accuracy_by_city AS
SELECT
  v.city,
  COUNT(*) FILTER (WHERE al.match_kind NOT IN ('unmeasurable')) AS sample_size,
  ROUND(
    AVG(al.match_score) FILTER (WHERE al.match_kind NOT IN ('unmeasurable')) * 100,
    1
  ) AS accuracy_14d_pct,
  COUNT(*) FILTER (WHERE al.match_kind = 'exact') AS exact,
  COUNT(*) FILTER (WHERE al.match_kind = 'one_step') AS one_step,
  COUNT(*) FILTER (WHERE al.match_kind = 'miss') AS miss,
  COUNT(*) FILTER (WHERE al.match_kind = 'unmeasurable') AS unmeasurable
FROM public.headcount_accuracy_log al
JOIN public.venues v ON v.id = al.venue_id
WHERE al.recorded_at >= now() - interval '14 days'
GROUP BY v.city
ORDER BY accuracy_14d_pct DESC NULLS LAST;

-- Per-venue accuracy view -- for finding which venues the engine struggles on
CREATE OR REPLACE VIEW public.engine_accuracy_by_venue AS
SELECT
  v.name,
  v.city,
  COUNT(*) FILTER (WHERE al.match_kind NOT IN ('unmeasurable')) AS sample_size,
  ROUND(
    AVG(al.match_score) FILTER (WHERE al.match_kind NOT IN ('unmeasurable')) * 100,
    1
  ) AS accuracy_pct,
  COUNT(*) FILTER (WHERE al.match_kind = 'exact') AS exact,
  COUNT(*) FILTER (WHERE al.match_kind = 'one_step') AS one_step,
  COUNT(*) FILTER (WHERE al.match_kind = 'miss') AS miss,
  MAX(al.recorded_at) AS last_truth_at
FROM public.headcount_accuracy_log al
JOIN public.venues v ON v.id = al.venue_id
WHERE al.recorded_at >= now() - interval '30 days'
GROUP BY v.id, v.name, v.city
HAVING COUNT(*) FILTER (WHERE al.match_kind NOT IN ('unmeasurable')) > 0
ORDER BY sample_size DESC, accuracy_pct DESC;

-- Per-baseline-source accuracy -- for tuning: is BestTime live better than
-- the manual curve? Is category_default actually useful?
CREATE OR REPLACE VIEW public.engine_accuracy_by_baseline AS
SELECT
  al.predicted_baseline_source,
  COUNT(*) AS sample_size,
  ROUND(AVG(al.match_score) * 100, 1) AS accuracy_pct,
  COUNT(*) FILTER (WHERE al.match_kind = 'exact') AS exact,
  COUNT(*) FILTER (WHERE al.match_kind = 'one_step') AS one_step,
  COUNT(*) FILTER (WHERE al.match_kind = 'miss') AS miss
FROM public.headcount_accuracy_log al
WHERE al.recorded_at >= now() - interval '30 days'
  AND al.match_kind NOT IN ('unmeasurable')
  AND al.predicted_baseline_source IS NOT NULL
GROUP BY al.predicted_baseline_source
ORDER BY sample_size DESC;

DO $$
BEGIN
  RAISE NOTICE '-----------------------------------';
  RAISE NOTICE 'Engine accuracy views deployed';
  RAISE NOTICE 'engine_accuracy_overall -- 7/14/30d rollup';
  RAISE NOTICE 'engine_accuracy_by_city -- Tampa vs Knox vs StPete';
  RAISE NOTICE 'engine_accuracy_by_venue -- per-bar diagnostic';
  RAISE NOTICE 'engine_accuracy_by_baseline -- tuning loop';
  RAISE NOTICE '-----------------------------------';
END $$;

COMMIT;
