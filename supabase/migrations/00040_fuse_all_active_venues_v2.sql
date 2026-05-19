BEGIN;

CREATE OR REPLACE FUNCTION public.fuse_all_active_venues()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_venue record;
  v_est record;
  v_count int := 0;
  v_trend_for_db text;
BEGIN
  FOR v_venue IN
    SELECT id FROM public.venues
    WHERE COALESCE(is_active, true) = true
      AND (category IS NULL OR category NOT IN ('greek', 'fraternity'))
      AND city IN ('knoxville', 'tampa', 'st_petersburg')
  LOOP
    SELECT * INTO v_est FROM public.compute_venue_estimate(v_venue.id);
    IF v_est IS NULL THEN
      CONTINUE;
    END IF;

    v_trend_for_db := CASE
      WHEN v_est.trend IS NULL OR v_est.trend = 'stable' THEN 'flat'
      ELSE v_est.trend
    END;

    INSERT INTO public.headcount_estimates (
      venue_id, estimate, estimate_low, estimate_high,
      confidence, confidence_pct,
      capacity_pct, state_label, trend, trend_rate,
      baseline_component, signal_component,
      override_active, last_signal_at,
      source_breakdown, computed_at,
      last_calculated_at, updated_at,
      delta_pct, expected_pct
    ) VALUES (
      v_venue.id,
      v_est.estimate, v_est.estimate_low, v_est.estimate_high,
      v_est.confidence_pct / 100.0, v_est.confidence_pct,
      v_est.capacity_pct, v_est.state_label, v_trend_for_db, v_est.trend_rate,
      v_est.baseline_component, v_est.signal_component,
      v_est.override_active, v_est.last_signal_at,
      v_est.source_breakdown, now(),
      now(), now(),
      v_est.delta_pct, v_est.expected_pct
    )
    ON CONFLICT (venue_id) DO UPDATE SET
      estimate          = EXCLUDED.estimate,
      estimate_low      = EXCLUDED.estimate_low,
      estimate_high     = EXCLUDED.estimate_high,
      confidence        = EXCLUDED.confidence,
      confidence_pct    = EXCLUDED.confidence_pct,
      capacity_pct      = EXCLUDED.capacity_pct,
      state_label       = EXCLUDED.state_label,
      trend             = EXCLUDED.trend,
      trend_rate        = EXCLUDED.trend_rate,
      baseline_component = EXCLUDED.baseline_component,
      signal_component  = EXCLUDED.signal_component,
      override_active   = EXCLUDED.override_active,
      last_signal_at    = EXCLUDED.last_signal_at,
      source_breakdown  = EXCLUDED.source_breakdown,
      computed_at       = EXCLUDED.computed_at,
      last_calculated_at = EXCLUDED.last_calculated_at,
      updated_at        = now(),
      delta_pct         = EXCLUDED.delta_pct,
      expected_pct      = EXCLUDED.expected_pct;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

DO $$
BEGIN
  RAISE NOTICE '-----------------------------------';
  RAISE NOTICE 'fuse_all_active_venues v2 deployed';
  RAISE NOTICE 'Now writes delta_pct, trend_rate, expected_pct';
  RAISE NOTICE '-----------------------------------';
END $$;

COMMIT;
