-- ═══════════════════════════════════════════════════════════════
-- 00017_fusion_quality_filters.sql
--
-- Two surgical updates to the fusion engine:
--   1. fuse_all_active_venues() restricts to launch-market venues
--      (knoxville, tampa, st_petersburg). Other cities still hold
--      seed data but no longer get fused into headcount_estimates.
--   2. compute_venue_estimate() introduces a 'no_data' sentinel:
--      when a venue has no BestTime live, no BestTime forecast for
--      the current hour, and zero active signals in the 90-min
--      window, it returns state_label='Unknown' / confidence_pct=5 /
--      source_breakdown.baseline_source='no_data' instead of
--      fabricating a number from the category default.
--      Downstream rendering can suppress 'no_data' venues on the map.
--
-- Also one-time DELETE of any non-launch-market rows already sitting
-- in headcount_estimates from earlier fusion runs.
--
-- Both functions are CREATE OR REPLACE in-place (signatures unchanged
-- from 00014). Wrapped in BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- compute_venue_estimate: add 'no_data' sentinel before falling back
-- to category_default.
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_venue_estimate(p_venue_id uuid)
RETURNS TABLE (
  estimate int,
  estimate_low int,
  estimate_high int,
  confidence_pct int,
  capacity_pct numeric,
  state_label text,
  trend text,
  baseline_component int,
  signal_component int,
  override_active boolean,
  last_signal_at timestamptz,
  source_breakdown jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_capacity int;
  v_category text;
  v_live_pct int;
  v_live_updated timestamptz;
  v_local_now timestamp;
  v_local_hour int;

  v_override_value numeric;
  v_override_at timestamptz;

  v_baseline_pct numeric := 0;
  v_baseline_source text := 'category_default';
  v_baseline_conf_boost int := 5;
  v_forecast_busyness int;

  v_signal_component numeric := 0;
  v_signal_breakdown jsonb := '{}'::jsonb;
  v_signal_count int := 0;
  v_distinct_types int := 0;
  v_recent_signals_count int := 0;
  v_newest_signal_age numeric;
  v_newest_signal_at timestamptz;

  v_anomaly_dir text;
  v_anomaly_delta numeric;
  v_anomaly_contrib numeric := 0;

  v_nfc_count int := 0;
  v_loyalty_count int := 0;
  v_cover_count int := 0;
  v_recap_count int := 0;
  v_dir_count int := 0;
  v_view_count int := 0;
  v_user_contrib numeric := 0;
  v_signal_clamp numeric;

  v_estimate_pct numeric;
  v_estimate_int int;
  v_capacity_pct_out numeric;
  v_state text;

  v_confidence int := 0;
  v_band_pct numeric;
  v_estimate_low_out int;
  v_estimate_high_out int;

  v_trend text;
  v_prior_estimate int;
  v_prior_at timestamptz;

  v_no_data_check int;
BEGIN
  SELECT capacity, category, live_busyness_pct, live_busyness_updated_at
  INTO v_capacity, v_category, v_live_pct, v_live_updated
  FROM public.venues WHERE id = p_venue_id;

  v_local_now := (now() AT TIME ZONE 'America/New_York');
  v_local_hour := EXTRACT(HOUR FROM v_local_now)::int;

  -- ── STEP 1: bouncer override (last 60 min) wins ──
  SELECT signal_value, recorded_at
  INTO v_override_value, v_override_at
  FROM public.headcount_signals
  WHERE venue_id = p_venue_id
    AND signal_type = 'bouncer_headcount'
    AND recorded_at > now() - interval '60 minutes'
  ORDER BY recorded_at DESC
  LIMIT 1;

  IF v_override_value IS NOT NULL THEN
    v_estimate_int := GREATEST(0, v_override_value::int);
    v_capacity_pct_out := CASE WHEN v_capacity IS NOT NULL AND v_capacity > 0
                               THEN v_estimate_int::numeric / v_capacity
                               ELSE NULL END;

    IF v_capacity_pct_out IS NOT NULL THEN
      v_state := CASE
        WHEN v_capacity_pct_out >= 1.10 THEN 'Surging'
        WHEN v_capacity_pct_out >= 0.85 THEN 'Packed'
        WHEN v_capacity_pct_out >= 0.60 THEN 'Busy'
        WHEN v_capacity_pct_out >= 0.30 THEN 'Lively'
        ELSE 'Quiet'
      END;
    ELSE
      v_state := CASE
        WHEN v_estimate_int >= 100 THEN 'Packed'
        WHEN v_estimate_int >= 60  THEN 'Busy'
        WHEN v_estimate_int >= 25  THEN 'Lively'
        ELSE 'Quiet'
      END;
    END IF;

    RETURN QUERY SELECT
      v_estimate_int,
      v_estimate_int,
      v_estimate_int,
      95::int,
      v_capacity_pct_out,
      v_state,
      NULL::text,
      0::int,
      0::int,
      true,
      v_override_at,
      jsonb_build_object(
        'baseline_source', 'bouncer_override',
        'override_count', v_override_value,
        'override_at', v_override_at
      );
    RETURN;
  END IF;

  -- ── STEP 2: baseline ──
  IF v_live_pct IS NOT NULL AND v_live_updated IS NOT NULL
     AND v_live_updated > now() - interval '90 minutes' THEN
    v_baseline_pct := v_live_pct;
    v_baseline_source := 'besttime_live';
    v_baseline_conf_boost := 30;
  ELSE
    v_forecast_busyness := public.get_current_hour_from_curve(p_venue_id);
    IF v_forecast_busyness IS NOT NULL THEN
      v_baseline_pct := v_forecast_busyness;
      v_baseline_source := 'besttime_forecast';
      v_baseline_conf_boost := 15;
    ELSE
      -- No live, no forecast. Only fall back to category default if there's
      -- ANY active signal (proof of user interest). With zero signals we
      -- have no information whatsoever — return a 'no_data' sentinel and
      -- let the renderer suppress the venue rather than fabricate a number.
      SELECT COUNT(*) INTO v_no_data_check
      FROM public.headcount_signals
      WHERE venue_id = p_venue_id
        AND recorded_at > now() - interval '90 minutes'
        AND expires_at > now();

      IF v_no_data_check = 0 THEN
        RETURN QUERY SELECT
          0::int,                 -- estimate
          0::int,                 -- estimate_low
          0::int,                 -- estimate_high
          5::int,                 -- confidence_pct
          NULL::numeric,          -- capacity_pct
          'Unknown'::text,        -- state_label
          NULL::text,             -- trend
          0::int,                 -- baseline_component
          0::int,                 -- signal_component
          false,                  -- override_active
          NULL::timestamptz,      -- last_signal_at
          jsonb_build_object(
            'baseline_source', 'no_data',
            'live_busyness_pct', v_live_pct,
            'forecast_busyness_pct', NULL,
            'total_signals_in_window', 0
          );
        RETURN;
      END IF;

      v_baseline_pct := public.category_default_pct(v_category, v_local_hour);
      v_baseline_source := 'category_default';
      v_baseline_conf_boost := 5;
    END IF;
  END IF;

  -- ── STEP 3: signals (conservative ±15% nudge) ──

  SELECT metadata->>'direction', signal_value
  INTO v_anomaly_dir, v_anomaly_delta
  FROM public.headcount_signals
  WHERE venue_id = p_venue_id
    AND signal_type = 'besttime_anomaly'
    AND recorded_at > now() - interval '90 minutes'
    AND expires_at > now()
  ORDER BY recorded_at DESC
  LIMIT 1;

  IF v_anomaly_dir = 'surge' AND v_anomaly_delta IS NOT NULL THEN
    v_anomaly_contrib := LEAST(20, ABS(v_anomaly_delta) * 0.3);
  ELSIF v_anomaly_dir = 'dud' AND v_anomaly_delta IS NOT NULL THEN
    v_anomaly_contrib := -LEAST(15, ABS(v_anomaly_delta) * 0.2);
  ELSE
    v_anomaly_contrib := 0;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE signal_type = 'nfc_tap'),
    COUNT(*) FILTER (WHERE signal_type = 'loyalty_visit'),
    COUNT(*) FILTER (WHERE signal_type = 'cover_purchase'),
    COUNT(*) FILTER (WHERE signal_type = 'recap_post'),
    COUNT(*) FILTER (WHERE signal_type = 'direction_request'),
    COUNT(*) FILTER (WHERE signal_type = 'card_view'),
    COUNT(*),
    COUNT(DISTINCT signal_type),
    COUNT(*) FILTER (WHERE recorded_at > now() - interval '30 minutes'),
    MAX(recorded_at)
  INTO
    v_nfc_count, v_loyalty_count, v_cover_count, v_recap_count,
    v_dir_count, v_view_count,
    v_signal_count, v_distinct_types, v_recent_signals_count, v_newest_signal_at
  FROM public.headcount_signals
  WHERE venue_id = p_venue_id
    AND recorded_at > now() - interval '90 minutes'
    AND expires_at > now();

  v_user_contrib :=
      LEAST(10::numeric, v_nfc_count     * 1.5)
    + LEAST(8::numeric,  v_loyalty_count * 1.0)
    + LEAST(12::numeric, v_cover_count   * 2.0)
    + LEAST(4::numeric,  v_recap_count   * 0.5)
    + LEAST(3::numeric,  v_dir_count     * 0.3)
    + LEAST(2::numeric,  v_view_count    * 0.1);

  v_signal_component := v_user_contrib + v_anomaly_contrib;

  v_signal_clamp := GREATEST(1.0, v_baseline_pct * 0.15);
  IF v_signal_component > v_signal_clamp THEN
    v_signal_component := v_signal_clamp;
  ELSIF v_signal_component < -v_signal_clamp THEN
    v_signal_component := -v_signal_clamp;
  END IF;

  v_signal_breakdown := jsonb_build_object(
    'nfc_tap', v_nfc_count,
    'loyalty_visit', v_loyalty_count,
    'cover_purchase', v_cover_count,
    'recap_post', v_recap_count,
    'direction_request', v_dir_count,
    'card_view', v_view_count,
    'besttime_anomaly_contrib', round(v_anomaly_contrib, 2),
    'besttime_anomaly_direction', v_anomaly_dir,
    'user_contrib_raw', round(v_user_contrib, 2),
    'clamped_to', round(v_signal_clamp, 2)
  );

  -- ── STEP 4: estimate_pct → absolute ──
  v_estimate_pct := GREATEST(0, LEAST(150, v_baseline_pct + v_signal_component));

  IF v_capacity IS NOT NULL AND v_capacity > 0 THEN
    v_estimate_int := ROUND(v_estimate_pct * v_capacity / 100.0)::int;
    v_capacity_pct_out := v_estimate_pct / 100.0;
  ELSE
    v_estimate_int := ROUND(v_estimate_pct)::int;
    v_capacity_pct_out := NULL;
  END IF;

  -- ── STEP 5: confidence ──
  v_confidence := v_baseline_conf_boost;
  v_confidence := v_confidence + LEAST(20, v_distinct_types * 5);
  IF v_recent_signals_count >= 5 THEN
    v_confidence := v_confidence + 10;
  END IF;
  IF v_baseline_source = 'besttime_live' AND v_signal_count >= 3 THEN
    v_confidence := v_confidence + 10;
  END IF;
  IF v_baseline_source <> 'besttime_live'
     AND (v_newest_signal_age IS NULL OR v_newest_signal_age > 60) THEN
    v_confidence := v_confidence - 20;
  END IF;
  v_confidence := GREATEST(0, LEAST(100, v_confidence));

  -- ── STEP 6: state_label ──
  IF v_capacity_pct_out IS NOT NULL THEN
    v_state := CASE
      WHEN v_capacity_pct_out >= 1.10 THEN 'Surging'
      WHEN v_capacity_pct_out >= 0.85 THEN 'Packed'
      WHEN v_capacity_pct_out >= 0.60 THEN 'Busy'
      WHEN v_capacity_pct_out >= 0.30 THEN 'Lively'
      ELSE 'Quiet'
    END;
  ELSE
    v_state := CASE
      WHEN v_estimate_pct >= 85 THEN 'Surging'
      WHEN v_estimate_pct >= 70 THEN 'Packed'
      WHEN v_estimate_pct >= 50 THEN 'Busy'
      WHEN v_estimate_pct >= 25 THEN 'Lively'
      ELSE 'Quiet'
    END;
  END IF;

  -- ── STEP 7: uncertainty band ──
  v_band_pct := (100 - v_confidence) * 0.40;
  v_estimate_low_out := GREATEST(0, ROUND(v_estimate_int * (1 - v_band_pct / 100.0))::int);
  v_estimate_high_out := ROUND(v_estimate_int * (1 + v_band_pct / 100.0))::int;

  -- ── STEP 8: trend ──
  SELECT he.estimate, COALESCE(he.computed_at, he.last_calculated_at)
  INTO v_prior_estimate, v_prior_at
  FROM public.headcount_estimates he
  WHERE he.venue_id = p_venue_id;

  IF v_prior_estimate IS NULL OR v_prior_at IS NULL OR v_prior_at < now() - interval '60 minutes' THEN
    v_trend := NULL;
  ELSIF v_prior_estimate = 0 THEN
    v_trend := CASE WHEN v_estimate_int > 0 THEN 'rising' ELSE 'stable' END;
  ELSIF v_estimate_int >= v_prior_estimate * 1.20 THEN
    v_trend := 'rising';
  ELSIF v_estimate_int <= v_prior_estimate * 0.80 THEN
    v_trend := 'falling';
  ELSE
    v_trend := 'stable';
  END IF;

  v_newest_signal_age := COALESCE(v_newest_signal_age,
    CASE WHEN v_newest_signal_at IS NULL THEN NULL
         ELSE EXTRACT(EPOCH FROM (now() - v_newest_signal_at)) / 60.0 END);

  RETURN QUERY SELECT
    v_estimate_int,
    v_estimate_low_out,
    v_estimate_high_out,
    v_confidence,
    v_capacity_pct_out,
    v_state,
    v_trend,
    ROUND(v_baseline_pct)::int,
    ROUND(v_signal_component)::int,
    false,
    v_newest_signal_at,
    v_signal_breakdown
      || jsonb_build_object(
        'baseline_source', v_baseline_source,
        'baseline_pct', round(v_baseline_pct, 1),
        'signal_component', round(v_signal_component, 2),
        'live_busyness_pct', v_live_pct,
        'forecast_busyness_pct', v_forecast_busyness,
        'total_signals_in_window', v_signal_count,
        'newest_signal_age_minutes',
          CASE WHEN v_newest_signal_at IS NULL THEN NULL
               ELSE round(EXTRACT(EPOCH FROM (now() - v_newest_signal_at)) / 60.0, 1)
          END
      );
END;
$$;

-- ───────────────────────────────────────────────────────────────
-- fuse_all_active_venues: restrict to launch-market cities.
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fuse_all_active_venues()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
      capacity_pct, state_label, trend,
      baseline_component, signal_component,
      override_active, last_signal_at,
      source_breakdown, computed_at,
      last_calculated_at, updated_at
    ) VALUES (
      v_venue.id,
      v_est.estimate, v_est.estimate_low, v_est.estimate_high,
      v_est.confidence_pct / 100.0, v_est.confidence_pct,
      v_est.capacity_pct, v_est.state_label, v_trend_for_db,
      v_est.baseline_component, v_est.signal_component,
      v_est.override_active, v_est.last_signal_at,
      v_est.source_breakdown, now(),
      now(), now()
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
      baseline_component = EXCLUDED.baseline_component,
      signal_component  = EXCLUDED.signal_component,
      override_active   = EXCLUDED.override_active,
      last_signal_at    = EXCLUDED.last_signal_at,
      source_breakdown  = EXCLUDED.source_breakdown,
      computed_at       = EXCLUDED.computed_at,
      last_calculated_at = EXCLUDED.last_calculated_at,
      updated_at        = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ───────────────────────────────────────────────────────────────
-- One-time cleanup: drop estimate rows for non-launch-market venues
-- that may have landed during earlier fusion runs.
-- ───────────────────────────────────────────────────────────────
DELETE FROM public.headcount_estimates
WHERE venue_id IN (
  SELECT id FROM public.venues
  WHERE city NOT IN ('knoxville', 'tampa', 'st_petersburg')
);

-- ───────────────────────────────────────────────────────────────
-- Verify
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  est_count int;
  non_launch_residual int;
BEGIN
  SELECT COUNT(*) INTO est_count FROM public.headcount_estimates;
  SELECT COUNT(*) INTO non_launch_residual
  FROM public.headcount_estimates h
  JOIN public.venues v ON v.id = h.venue_id
  WHERE v.city NOT IN ('knoxville', 'tampa', 'st_petersburg');

  RAISE NOTICE '═══ Migration 00017 complete ═══';
  RAISE NOTICE '  fuse_all_active_venues() — now scoped to launch markets:';
  RAISE NOTICE '    knoxville, tampa, st_petersburg';
  RAISE NOTICE '  compute_venue_estimate() — adds ''no_data'' sentinel:';
  RAISE NOTICE '    state_label=''Unknown'', confidence_pct=5,';
  RAISE NOTICE '    source_breakdown.baseline_source=''no_data''';
  RAISE NOTICE '    when no live + no forecast + no signals.';
  RAISE NOTICE '  headcount_estimates rows after cleanup: %', est_count;
  RAISE NOTICE '  Non-launch residual (should be 0):     %', non_launch_residual;
END $$;

COMMIT;
