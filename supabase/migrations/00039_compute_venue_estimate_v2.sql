BEGIN;

DROP FUNCTION IF EXISTS public.compute_venue_estimate(uuid);

CREATE OR REPLACE FUNCTION public.compute_venue_estimate(p_venue_id uuid)
 RETURNS TABLE(
   estimate integer,
   estimate_low integer,
   estimate_high integer,
   confidence_pct integer,
   capacity_pct numeric,
   state_label text,
   trend text,
   trend_rate numeric,
   baseline_component integer,
   signal_component integer,
   override_active boolean,
   last_signal_at timestamp with time zone,
   source_breakdown jsonb,
   delta_pct numeric,
   expected_pct numeric
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_capacity int;
  v_effective_capacity int;
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
  v_expected_pct_for_curve int;
  v_forecast_busyness int;
  v_manual_busyness int;

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
  v_geofence_count int := 0;
  v_presence_count int := 0;
  v_plan_intent_count int := 0;
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
  v_trend_rate_out numeric;
  v_prior_estimate int;
  v_prior_at timestamptz;
  v_minutes_since_prior numeric;

  v_delta_pct_out numeric;
  v_expected_pct_out numeric;

  v_no_data_check int;
BEGIN
  -- Read venue context. Note: we now read effective_capacity too
  -- (for display-only headcount), but state labels NO LONGER depend
  -- on fire-code capacity.
  SELECT capacity, effective_capacity, category, live_busyness_pct, live_busyness_updated_at
  INTO v_capacity, v_effective_capacity, v_category, v_live_pct, v_live_updated
  FROM public.venues WHERE id = p_venue_id;

  v_local_now := (now() AT TIME ZONE 'America/New_York');
  v_local_hour := EXTRACT(HOUR FROM v_local_now)::int;

  -- ------------------------------------------------------------
  -- STEP 1: bouncer override (last 60 min) wins everything
  -- ------------------------------------------------------------
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
    v_capacity_pct_out := CASE
      WHEN COALESCE(v_effective_capacity, v_capacity) IS NOT NULL
       AND COALESCE(v_effective_capacity, v_capacity) > 0
      THEN v_estimate_int::numeric / COALESCE(v_effective_capacity, v_capacity)
      ELSE NULL
    END;

    -- For overrides, state label is straightforward — staff just told
    -- us the count. We use felt-busyness thresholds against capacity
    -- when we have one, absolute headcount when we don't.
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
      NULL::text,                   -- trend
      NULL::numeric,                -- trend_rate
      0::int,
      0::int,
      true,
      v_override_at,
      jsonb_build_object(
        'baseline_source', 'bouncer_override',
        'override_count', v_override_value,
        'override_at', v_override_at
      ),
      NULL::numeric,                -- delta_pct (override doesn't compute one)
      NULL::numeric;                -- expected_pct
    RETURN;
  END IF;

  -- ------------------------------------------------------------
  -- STEP 2: baseline cascade — NEW ORDER
  --   (a) BestTime live (< 90 min fresh)        +30 conf
  --   (b) BestTime forecast curve               +15 conf
  --   (c) Manual operator curve                 +12 conf  <- NEW
  --   (d) Category default stereotype           +5  conf
  -- ------------------------------------------------------------
  IF v_live_pct IS NOT NULL AND v_live_updated IS NOT NULL
     AND v_live_updated > now() - interval '90 minutes' THEN
    v_baseline_pct := v_live_pct;
    v_baseline_source := 'besttime_live';
    v_baseline_conf_boost := 30;
    -- For live data, the "expected" reference comes from forecast curve
    v_forecast_busyness := public.get_current_hour_from_curve(p_venue_id);
    IF v_forecast_busyness IS NULL THEN
      v_forecast_busyness := public.get_current_hour_from_manual_curve(p_venue_id);
    END IF;
    v_expected_pct_for_curve := v_forecast_busyness;
  ELSE
    v_forecast_busyness := public.get_current_hour_from_curve(p_venue_id);
    IF v_forecast_busyness IS NOT NULL THEN
      v_baseline_pct := v_forecast_busyness;
      v_baseline_source := 'besttime_forecast';
      v_baseline_conf_boost := 15;
      v_expected_pct_for_curve := v_forecast_busyness;
    ELSE
      v_manual_busyness := public.get_current_hour_from_manual_curve(p_venue_id);
      IF v_manual_busyness IS NOT NULL THEN
        v_baseline_pct := v_manual_busyness;
        v_baseline_source := 'manual_curve';
        v_baseline_conf_boost := 12;
        v_expected_pct_for_curve := v_manual_busyness;
      ELSE
        SELECT COUNT(*) INTO v_no_data_check
        FROM public.headcount_signals
        WHERE venue_id = p_venue_id
          AND recorded_at > now() - interval '90 minutes'
          AND expires_at > now();

        IF v_no_data_check = 0 THEN
          RETURN QUERY SELECT
            0::int, 0::int, 0::int, 5::int,
            NULL::numeric, 'Unknown'::text, NULL::text, NULL::numeric,
            0::int, 0::int, false, NULL::timestamptz,
            jsonb_build_object(
              'baseline_source', 'no_data',
              'live_busyness_pct', v_live_pct,
              'forecast_busyness_pct', NULL,
              'manual_busyness_pct', NULL,
              'total_signals_in_window', 0
            ),
            NULL::numeric, NULL::numeric;
          RETURN;
        END IF;

        v_baseline_pct := public.category_default_pct(v_category, v_local_hour);
        v_baseline_source := 'category_default';
        v_baseline_conf_boost := 5;
        v_expected_pct_for_curve := v_baseline_pct;
      END IF;
    END IF;
  END IF;

  -- ------------------------------------------------------------
  -- STEP 3: signal nudge (conservative +/- 15% of baseline)
  -- Now includes geofence + presence + plan_intent (Phase 2 wires
  -- these to actually fire; engine already reads them today, so
  -- they'll start contributing the moment Phase 2 ships)
  -- ------------------------------------------------------------
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
    COUNT(*) FILTER (WHERE signal_type = 'app_open_in_geofence'),
    COUNT(*) FILTER (WHERE signal_type = 'background_presence'),
    COUNT(*) FILTER (WHERE signal_type = 'plan_intent'),
    COUNT(*),
    COUNT(DISTINCT signal_type),
    COUNT(*) FILTER (WHERE recorded_at > now() - interval '30 minutes'),
    MAX(recorded_at)
  INTO
    v_nfc_count, v_loyalty_count, v_cover_count, v_recap_count,
    v_dir_count, v_view_count, v_geofence_count, v_presence_count,
    v_plan_intent_count,
    v_signal_count, v_distinct_types, v_recent_signals_count, v_newest_signal_at
  FROM public.headcount_signals
  WHERE venue_id = p_venue_id
    AND recorded_at > now() - interval '90 minutes'
    AND expires_at > now();

  v_user_contrib :=
      LEAST(10::numeric, v_nfc_count       * 1.5)
    + LEAST(8::numeric,  v_loyalty_count   * 1.0)
    + LEAST(12::numeric, v_cover_count     * 2.0)
    + LEAST(4::numeric,  v_recap_count     * 0.5)
    + LEAST(3::numeric,  v_dir_count       * 0.3)
    + LEAST(2::numeric,  v_view_count      * 0.1)
    + LEAST(8::numeric,  v_geofence_count  * 1.2)
    + LEAST(10::numeric, v_presence_count  * 1.5)
    + LEAST(5::numeric,  v_plan_intent_count * 0.8);

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
    'app_open_in_geofence', v_geofence_count,
    'background_presence', v_presence_count,
    'plan_intent', v_plan_intent_count,
    'besttime_anomaly_contrib', round(v_anomaly_contrib, 2),
    'besttime_anomaly_direction', v_anomaly_dir,
    'user_contrib_raw', round(v_user_contrib, 2),
    'clamped_to', round(v_signal_clamp, 2)
  );

  -- ------------------------------------------------------------
  -- STEP 4: estimate_pct -> absolute headcount
  -- effective_capacity used for display only (the absolute number),
  -- not for state-label thresholds anymore.
  -- ------------------------------------------------------------
  v_estimate_pct := GREATEST(0, LEAST(150, v_baseline_pct + v_signal_component));

  IF COALESCE(v_effective_capacity, v_capacity) IS NOT NULL
     AND COALESCE(v_effective_capacity, v_capacity) > 0 THEN
    v_estimate_int := ROUND(v_estimate_pct * COALESCE(v_effective_capacity, v_capacity) / 100.0)::int;
    -- capacity_pct still computed for display, but doesn't drive state
    v_capacity_pct_out := v_estimate_int::numeric / COALESCE(v_effective_capacity, v_capacity);
  ELSE
    v_estimate_int := ROUND(v_estimate_pct)::int;
    v_capacity_pct_out := NULL;
  END IF;

  -- ------------------------------------------------------------
  -- STEP 4.5: NEW — compute delta_pct and expected_pct
  -- delta_pct = (estimate_pct / expected_pct) - 1, expressed as %
  -- Only computed if we have a real expected curve value.
  -- ------------------------------------------------------------
  v_expected_pct_out := v_expected_pct_for_curve;
  IF v_expected_pct_for_curve IS NOT NULL
     AND v_expected_pct_for_curve > 0
     AND v_baseline_source <> 'category_default' THEN
    v_delta_pct_out := ROUND(
      ((v_estimate_pct / v_expected_pct_for_curve::numeric) - 1) * 100,
      1
    );
    -- Cap extreme values for sanity
    IF v_delta_pct_out > 200 THEN v_delta_pct_out := 200; END IF;
    IF v_delta_pct_out < -100 THEN v_delta_pct_out := -100; END IF;
  ELSE
    v_delta_pct_out := NULL;
  END IF;

  -- ------------------------------------------------------------
  -- STEP 5: confidence
  -- ------------------------------------------------------------
  v_confidence := v_baseline_conf_boost;
  v_confidence := v_confidence + LEAST(20, v_distinct_types * 5);
  IF v_recent_signals_count >= 5 THEN
    v_confidence := v_confidence + 10;
  END IF;
  IF v_baseline_source = 'besttime_live' AND v_signal_count >= 3 THEN
    v_confidence := v_confidence + 10;
  END IF;
  IF v_baseline_source NOT IN ('besttime_live')
     AND (v_newest_signal_age IS NULL OR v_newest_signal_age > 60) THEN
    v_confidence := v_confidence - 20;
  END IF;
  v_confidence := GREATEST(0, LEAST(100, v_confidence));

  -- ------------------------------------------------------------
  -- STEP 6: state_label — NEW FELT-BUSYNESS LOGIC
  -- Locked thresholds:
  --   Surging:  delta_pct >= +30 AND v_estimate_pct >= 60
  --   Packed:   v_estimate_pct >= 85 (regardless of delta)
  --   Busy:     v_estimate_pct >= 60 AND delta_pct >= -10 (on-pace at peak)
  --   Lively:   v_estimate_pct >= 40 (any) OR delta_pct >= -25 (close to expected)
  --   Quiet:    delta_pct < -25 OR v_estimate_pct < 40 with negative delta
  --   Unknown:  confidence < 20 (truth floor)
  -- ------------------------------------------------------------
  IF v_confidence < 20 THEN
    v_state := 'Unknown';
  ELSIF v_delta_pct_out IS NULL THEN
    -- Falling back to absolute thresholds when no curve available
    -- (category_default cases). Still uses estimate_pct as proxy.
    v_state := CASE
      WHEN v_estimate_pct >= 85 THEN 'Packed'
      WHEN v_estimate_pct >= 60 THEN 'Busy'
      WHEN v_estimate_pct >= 40 THEN 'Lively'
      ELSE 'Quiet'
    END;
  ELSE
    -- Felt-busyness fusion
    v_state := CASE
      WHEN v_delta_pct_out >= 30 AND v_estimate_pct >= 60 THEN 'Surging'
      WHEN v_estimate_pct >= 85 THEN 'Packed'
      WHEN v_estimate_pct >= 60 AND v_delta_pct_out >= -10 THEN 'Busy'
      WHEN v_estimate_pct >= 40 OR v_delta_pct_out >= -25 THEN 'Lively'
      ELSE 'Quiet'
    END;
  END IF;

  -- ------------------------------------------------------------
  -- STEP 7: uncertainty band
  -- ------------------------------------------------------------
  v_band_pct := (100 - v_confidence) * 0.40;
  v_estimate_low_out := GREATEST(0, ROUND(v_estimate_int * (1 - v_band_pct / 100.0))::int);
  v_estimate_high_out := ROUND(v_estimate_int * (1 + v_band_pct / 100.0))::int;

  -- ------------------------------------------------------------
  -- STEP 8: trend + trend_rate
  -- ------------------------------------------------------------
  SELECT he.estimate, COALESCE(he.computed_at, he.last_calculated_at)
  INTO v_prior_estimate, v_prior_at
  FROM public.headcount_estimates he
  WHERE he.venue_id = p_venue_id;

  IF v_prior_estimate IS NULL OR v_prior_at IS NULL OR v_prior_at < now() - interval '60 minutes' THEN
    v_trend := NULL;
    v_trend_rate_out := NULL;
  ELSIF v_prior_estimate = 0 THEN
    v_trend := CASE WHEN v_estimate_int > 0 THEN 'rising' ELSE 'stable' END;
    v_minutes_since_prior := GREATEST(1, EXTRACT(EPOCH FROM (now() - v_prior_at)) / 60.0);
    v_trend_rate_out := ROUND(v_estimate_int::numeric / v_minutes_since_prior, 2);
  ELSE
    v_minutes_since_prior := GREATEST(1, EXTRACT(EPOCH FROM (now() - v_prior_at)) / 60.0);
    v_trend_rate_out := ROUND(
      (v_estimate_int - v_prior_estimate)::numeric / v_minutes_since_prior,
      2
    );

    IF v_estimate_int >= v_prior_estimate * 1.20 THEN
      v_trend := 'rising';
    ELSIF v_estimate_int <= v_prior_estimate * 0.80 THEN
      v_trend := 'falling';
    ELSE
      v_trend := 'stable';
    END IF;
  END IF;

  v_newest_signal_age := COALESCE(v_newest_signal_age,
    CASE WHEN v_newest_signal_at IS NULL THEN NULL
         ELSE EXTRACT(EPOCH FROM (now() - v_newest_signal_at)) / 60.0 END);

  -- ------------------------------------------------------------
  -- EVENT DETECTION (unchanged from prior version)
  -- ------------------------------------------------------------
  PERFORM public.detect_and_record_events(
    p_venue_id            := p_venue_id,
    p_current_estimate    := v_estimate_int,
    p_current_state_label := v_state,
    p_prior_estimate      := v_prior_estimate,
    p_capacity_pct        := v_capacity_pct_out
  );

  RETURN QUERY SELECT
    v_estimate_int,
    v_estimate_low_out,
    v_estimate_high_out,
    v_confidence,
    v_capacity_pct_out,
    v_state,
    v_trend,
    v_trend_rate_out,
    ROUND(v_baseline_pct)::int,
    ROUND(v_signal_component)::int,
    false,
    v_newest_signal_at,
    v_signal_breakdown
      || jsonb_build_object(
        'baseline_source', v_baseline_source,
        'baseline_pct', round(v_baseline_pct, 1),
        'expected_pct', v_expected_pct_for_curve,
        'signal_component', round(v_signal_component, 2),
        'live_busyness_pct', v_live_pct,
        'forecast_busyness_pct', v_forecast_busyness,
        'manual_busyness_pct', v_manual_busyness,
        'total_signals_in_window', v_signal_count,
        'newest_signal_age_minutes',
          CASE WHEN v_newest_signal_at IS NULL THEN NULL
               ELSE round(EXTRACT(EPOCH FROM (now() - v_newest_signal_at)) / 60.0, 1)
          END
      ),
    v_delta_pct_out,
    v_expected_pct_out;
END;
$function$;

DO $$
BEGIN
  RAISE NOTICE '-----------------------------------';
  RAISE NOTICE 'compute_venue_estimate v2 deployed';
  RAISE NOTICE 'New fields: delta_pct, trend_rate, expected_pct';
  RAISE NOTICE 'New baseline tier: manual_curve';
  RAISE NOTICE 'New state logic: felt-busyness based';
  RAISE NOTICE '-----------------------------------';
END $$;

COMMIT;
