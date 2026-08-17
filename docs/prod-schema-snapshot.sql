


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."adjust_headcount"("target_venue" "uuid", "target_city" character varying, "target_night" "date", "adjustment" integer, "staff_user" "uuid" DEFAULT NULL::"uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  new_count INTEGER;
  new_peak INTEGER;
BEGIN
  INSERT INTO headcounts (venue_id, city, night_of, current_count, peak_count, last_updated_by, is_live)
  VALUES (target_venue, target_city, target_night, GREATEST(adjustment, 0), GREATEST(adjustment, 0), staff_user, true)
  ON CONFLICT (venue_id, night_of) DO UPDATE SET
    current_count = GREATEST(headcounts.current_count + adjustment, 0),
    peak_count = GREATEST(headcounts.peak_count, GREATEST(headcounts.current_count + adjustment, 0)),
    updated_at = NOW(),
    last_updated_by = staff_user,
    is_live = true
  RETURNING current_count, peak_count INTO new_count, new_peak;

  -- ── PREDICTION ENGINE: write bouncer_headcount signal ──
  PERFORM public.record_signal(
    target_venue,
    staff_user,
    'bouncer_headcount',
    new_count,
    NULL,
    NULL,
    jsonb_build_object('action', 'adjust', 'count', new_count, 'peak', new_peak, 'adjustment', adjustment, 'night_of', target_night)
  );

  RETURN json_build_object('new_count', new_count, 'peak', new_peak);
END;
$$;


ALTER FUNCTION "public"."adjust_headcount"("target_venue" "uuid", "target_city" character varying, "target_night" "date", "adjustment" integer, "staff_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bump_event_going_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.events SET going_count = going_count + 1 WHERE id = NEW.event_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.events SET going_count = GREATEST(0, going_count - 1) WHERE id = OLD.event_id;
  END IF;
  RETURN NULL;
END; $$;


ALTER FUNCTION "public"."bump_event_going_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."category_default_pct"("p_category" "text", "p_hour" integer) RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT CASE COALESCE(p_category, 'bar')
    WHEN 'cocktail' THEN
      CASE p_hour
        WHEN 17 THEN 20 WHEN 18 THEN 35 WHEN 19 THEN 50 WHEN 20 THEN 65
        WHEN 21 THEN 80 WHEN 22 THEN 90 WHEN 23 THEN 95
        WHEN 0  THEN 90 WHEN 1  THEN 70 WHEN 2  THEN 40
        ELSE 10
      END
    WHEN 'club' THEN
      CASE p_hour
        WHEN 21 THEN 30 WHEN 22 THEN 50 WHEN 23 THEN 75
        WHEN 0  THEN 95 WHEN 1  THEN 100 WHEN 2  THEN 90
        ELSE 0
      END
    WHEN 'nightclub' THEN
      CASE p_hour
        WHEN 21 THEN 30 WHEN 22 THEN 50 WHEN 23 THEN 75
        WHEN 0  THEN 95 WHEN 1  THEN 100 WHEN 2  THEN 90
        ELSE 0
      END
    ELSE  -- 'bar' / 'lounge' / 'dive' / unknown
      CASE p_hour
        WHEN 17 THEN 25 WHEN 18 THEN 45 WHEN 19 THEN 55 WHEN 20 THEN 60
        WHEN 21 THEN 70 WHEN 22 THEN 75 WHEN 23 THEN 70
        WHEN 0  THEN 55 WHEN 1  THEN 35 WHEN 2  THEN 20
        ELSE 15
      END
  END;
$$;


ALTER FUNCTION "public"."category_default_pct"("p_category" "text", "p_hour" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clean_expired_events"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_deleted int;
BEGIN
  WITH gone AS (
    DELETE FROM public.live_events
    WHERE expires_at < now()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted FROM gone;
  RETURN v_deleted;
END;
$$;


ALTER FUNCTION "public"."clean_expired_events"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_paint_prompt_due"("p_user_visit_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_visit public.user_visits%ROWTYPE;
  v_paint_exists boolean;
  v_prompt_id uuid;
  v_duration_min integer;
BEGIN
  SELECT * INTO v_visit FROM public.user_visits WHERE id = p_user_visit_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Duration check: 20+ min
  v_duration_min := COALESCE(
    v_visit.duration_min,
    EXTRACT(EPOCH FROM (v_visit.last_seen_at - v_visit.first_seen_at))::int / 60
  );

  IF v_duration_min < 20 THEN RETURN NULL; END IF;

  -- Already painted? (permanent first paint = no re-prompt)
  SELECT EXISTS (
    SELECT 1 FROM public.vibe_ratings
    WHERE user_id = v_visit.user_id AND venue_id = v_visit.venue_id
  ) INTO v_paint_exists;

  IF v_paint_exists THEN RETURN NULL; END IF;

  -- Insert (or no-op if already queued for this visit)
  INSERT INTO public.paint_prompts (
    user_id, venue_id, user_visit_id,
    visit_first_seen_at, visit_last_seen_at, visit_duration_min,
    fire_not_before
  ) VALUES (
    v_visit.user_id, v_visit.venue_id, v_visit.id,
    v_visit.first_seen_at, v_visit.last_seen_at, v_duration_min,
    v_visit.last_seen_at + interval '5 minutes'
  )
  ON CONFLICT (user_id, venue_id, visit_first_seen_at) DO NOTHING
  RETURNING id INTO v_prompt_id;

  RETURN v_prompt_id;
END $$;


ALTER FUNCTION "public"."compute_paint_prompt_due"("p_user_visit_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_venue_estimate"("p_venue_id" "uuid") RETURNS TABLE("estimate" integer, "estimate_low" integer, "estimate_high" integer, "confidence_pct" integer, "capacity_pct" numeric, "state_label" "text", "trend" "text", "trend_rate" numeric, "baseline_component" integer, "signal_component" integer, "override_active" boolean, "last_signal_at" timestamp with time zone, "source_breakdown" "jsonb", "delta_pct" numeric, "expected_pct" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
  v_w_nfc numeric;
  v_w_loyalty numeric;
  v_w_cover numeric;
  v_w_recap numeric;
  v_w_direction numeric;
  v_w_card numeric;
  v_w_geofence numeric;
  v_w_presence numeric;
  v_w_plan_intent numeric;
  v_fallback_expected numeric;
BEGIN
  -- Look up weights from config
  SELECT COALESCE(weight, 1.5) INTO v_w_nfc FROM signal_weights WHERE signal_type = 'nfc_tap';
  v_w_nfc := COALESCE(v_w_nfc, 1.5);
  SELECT COALESCE(weight, 1.0) INTO v_w_loyalty FROM signal_weights WHERE signal_type = 'loyalty_visit';
  v_w_loyalty := COALESCE(v_w_loyalty, 1.0);
  SELECT COALESCE(weight, 2.0) INTO v_w_cover FROM signal_weights WHERE signal_type = 'cover_purchase';
  v_w_cover := COALESCE(v_w_cover, 2.0);
  SELECT COALESCE(weight, 0.5) INTO v_w_recap FROM signal_weights WHERE signal_type = 'recap_post';
  v_w_recap := COALESCE(v_w_recap, 0.5);
  SELECT COALESCE(weight, 0.3) INTO v_w_direction FROM signal_weights WHERE signal_type = 'direction_request';
  v_w_direction := COALESCE(v_w_direction, 0.3);
  SELECT COALESCE(weight, 0.1) INTO v_w_card FROM signal_weights WHERE signal_type = 'card_view';
  v_w_card := COALESCE(v_w_card, 0.1);
  SELECT COALESCE(weight, 1.2) INTO v_w_geofence FROM signal_weights WHERE signal_type = 'app_open_in_geofence';
  v_w_geofence := COALESCE(v_w_geofence, 1.2);
  SELECT COALESCE(weight, 1.5) INTO v_w_presence FROM signal_weights WHERE signal_type = 'background_presence';
  v_w_presence := COALESCE(v_w_presence, 1.5);
  SELECT COALESCE(weight, 0.8) INTO v_w_plan_intent FROM signal_weights WHERE signal_type = 'plan_intent';
  v_w_plan_intent := COALESCE(v_w_plan_intent, 0.8);

  SELECT capacity, effective_capacity, category, live_busyness_pct, live_busyness_updated_at
  INTO v_capacity, v_effective_capacity, v_category, v_live_pct, v_live_updated
  FROM public.venues WHERE id = p_venue_id;

  v_local_now := (now() AT TIME ZONE 'America/New_York');
  v_local_hour := EXTRACT(HOUR FROM v_local_now)::int;

  -- STEP 1: bouncer override (unchanged)
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
        WHEN v_estimate_int >= 60 THEN 'Busy'
        WHEN v_estimate_int >= 25 THEN 'Lively'
        ELSE 'Quiet'
      END;
    END IF;
    RETURN QUERY SELECT
      v_estimate_int, v_estimate_int, v_estimate_int, 95::int,
      v_capacity_pct_out, v_state, NULL::text, NULL::numeric,
      0::int, 0::int, true, v_override_at,
      jsonb_build_object('baseline_source','bouncer_override','override_count',v_override_value,'override_at',v_override_at),
      NULL::numeric, NULL::numeric;
    RETURN;
  END IF;

  -- ═══ STEP 2: baseline cascade — MANUAL CURVE NOW PRIMARY (00068) ═══
  v_manual_busyness := public.get_current_hour_from_manual_curve(p_venue_id);
  IF v_manual_busyness IS NOT NULL THEN
    -- ▼▼▼ NEW PRIMARY: operator curve (conf 35 > besttime_live 30) ▼▼▼
    v_baseline_pct := v_manual_busyness;
    v_baseline_source := 'manual_curve';
    v_baseline_conf_boost := 35;
    v_expected_pct_for_curve := v_manual_busyness;
    -- ▲▲▲ NEW PRIMARY ▲▲▲
  ELSE
    -- ▼▼▼ NULL fall-through: EXISTING cascade, VERBATIM from live body ▼▼▼
    IF v_live_pct IS NOT NULL AND v_live_updated IS NOT NULL
       AND v_live_updated > now() - interval '90 minutes' THEN
      v_baseline_pct := v_live_pct;
      v_baseline_source := 'besttime_live';
      v_baseline_conf_boost := 30;
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
              0::int,0::int,0::int,5::int,
              NULL::numeric,'Unknown'::text,NULL::text,NULL::numeric,
              0::int,0::int,false,NULL::timestamptz,
              jsonb_build_object('baseline_source','no_data','live_busyness_pct',v_live_pct,
                'forecast_busyness_pct',NULL,'manual_busyness_pct',NULL,'total_signals_in_window',0),
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
    -- ▲▲▲ EXISTING cascade ▲▲▲
  END IF;

  -- STEP 3: signals (unchanged)
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
  INTO v_nfc_count, v_loyalty_count, v_cover_count, v_recap_count,
       v_dir_count, v_view_count, v_geofence_count, v_presence_count,
       v_plan_intent_count,
       v_signal_count, v_distinct_types, v_recent_signals_count, v_newest_signal_at
  FROM public.headcount_signals
  WHERE venue_id = p_venue_id
    AND recorded_at > now() - interval '90 minutes'
    AND expires_at > now();

  v_user_contrib :=
      LEAST(10::numeric, v_nfc_count * v_w_nfc)
    + LEAST(8::numeric, v_loyalty_count * v_w_loyalty)
    + LEAST(12::numeric, v_cover_count * v_w_cover)
    + LEAST(4::numeric, v_recap_count * v_w_recap)
    + LEAST(3::numeric, v_dir_count * v_w_direction)
    + LEAST(2::numeric, v_view_count * v_w_card)
    + LEAST(8::numeric, v_geofence_count * v_w_geofence)
    + LEAST(10::numeric, v_presence_count * v_w_presence)
    + LEAST(5::numeric, v_plan_intent_count * v_w_plan_intent);

  v_signal_component := v_user_contrib + v_anomaly_contrib;
  v_signal_clamp := GREATEST(1.0, v_baseline_pct * 0.15);
  IF v_signal_component > v_signal_clamp THEN
    v_signal_component := v_signal_clamp;
  ELSIF v_signal_component < -v_signal_clamp THEN
    v_signal_component := -v_signal_clamp;
  END IF;

  v_signal_breakdown := jsonb_build_object(
    'nfc_tap',v_nfc_count,'loyalty_visit',v_loyalty_count,
    'cover_purchase',v_cover_count,'recap_post',v_recap_count,
    'direction_request',v_dir_count,'card_view',v_view_count,
    'app_open_in_geofence',v_geofence_count,
    'background_presence',v_presence_count,
    'plan_intent',v_plan_intent_count,
    'besttime_anomaly_contrib',round(v_anomaly_contrib,2),
    'besttime_anomaly_direction',v_anomaly_dir,
    'user_contrib_raw',round(v_user_contrib,2),
    'clamped_to',round(v_signal_clamp,2),
    'weights_source','config'
  );

  -- STEP 4: estimate (unchanged)
  v_estimate_pct := GREATEST(0, LEAST(150, v_baseline_pct + v_signal_component));
  IF COALESCE(v_effective_capacity, v_capacity) IS NOT NULL
     AND COALESCE(v_effective_capacity, v_capacity) > 0 THEN
    v_estimate_int := ROUND(v_estimate_pct * COALESCE(v_effective_capacity, v_capacity) / 100.0)::int;
    v_capacity_pct_out := v_estimate_int::numeric / COALESCE(v_effective_capacity, v_capacity);
  ELSE
    v_estimate_int := ROUND(v_estimate_pct)::int;
    v_capacity_pct_out := NULL;
  END IF;

  -- ─── STEP 4.5 REWRITTEN AGAIN ───
  -- When BestTime's forecast curve is zero but live data is real,
  -- fall back to category_default for the expected value.
  -- This compares "what's actually happening" to "what a typical bar
  -- looks like at this hour" instead of to BestTime's broken zero.
  v_expected_pct_out := v_expected_pct_for_curve;

  IF v_baseline_source = 'category_default' THEN
    v_delta_pct_out := NULL;
  ELSIF v_expected_pct_for_curve IS NOT NULL AND v_expected_pct_for_curve > 0 THEN
    -- Standard case: divide by real forecast
    v_delta_pct_out := ROUND(
      ((v_estimate_pct / v_expected_pct_for_curve::numeric) - 1) * 100, 1);
    IF v_delta_pct_out > 150 THEN v_delta_pct_out := 150; END IF;
    IF v_delta_pct_out < -100 THEN v_delta_pct_out := -100; END IF;
  ELSE
    -- Forecast is zero or null but we have live data.
    -- Use category default as the sensible expected baseline.
    v_fallback_expected := public.category_default_pct(v_category, v_local_hour);
    v_expected_pct_out := v_fallback_expected::int;

    IF v_fallback_expected IS NULL OR v_fallback_expected <= 0 THEN
      -- Even category default is zero (e.g. 4am). Honest: no comparison possible.
      v_delta_pct_out := NULL;
    ELSE
      v_delta_pct_out := ROUND(
        ((v_estimate_pct / v_fallback_expected) - 1) * 100, 1);
      IF v_delta_pct_out > 150 THEN v_delta_pct_out := 150; END IF;
      IF v_delta_pct_out < -100 THEN v_delta_pct_out := -100; END IF;
    END IF;
  END IF;

  -- STEP 5: confidence — manual_curve now EXEMPT from staleness penalty (00069)
  v_confidence := v_baseline_conf_boost;
  v_confidence := v_confidence + LEAST(20, v_distinct_types * 5);
  IF v_recent_signals_count >= 5 THEN
    v_confidence := v_confidence + 10;
  END IF;
  IF v_baseline_source = 'besttime_live' AND v_signal_count >= 3 THEN
    v_confidence := v_confidence + 10;
  END IF;
  -- ▼▼▼ THE ONLY CHANGE (00069): 'manual_curve' added to the exemption ▼▼▼
  -- A manual operator curve is authoritative data, a peer of besttime_live,
  -- not a stale guess — so it must NOT be docked the staleness penalty.
  IF v_baseline_source NOT IN ('besttime_live', 'manual_curve')
     AND (v_newest_signal_age IS NULL OR v_newest_signal_age > 60) THEN
    v_confidence := v_confidence - 20;
  END IF;
  -- ▲▲▲ THE ONLY CHANGE ▲▲▲
  v_confidence := GREATEST(0, LEAST(100, v_confidence));

  -- STEP 6: state label (unchanged)
  IF v_confidence < 20 THEN
    v_state := 'Unknown';
  ELSIF v_delta_pct_out IS NULL THEN
    v_state := CASE
      WHEN v_estimate_pct >= 85 THEN 'Packed'
      WHEN v_estimate_pct >= 60 THEN 'Busy'
      WHEN v_estimate_pct >= 40 THEN 'Lively'
      ELSE 'Quiet'
    END;
  ELSE
    v_state := CASE
      WHEN v_delta_pct_out >= 30 AND v_estimate_pct >= 60 THEN 'Surging'
      WHEN v_estimate_pct >= 85 THEN 'Packed'
      WHEN v_estimate_pct >= 60 AND v_delta_pct_out >= -10 THEN 'Busy'
      WHEN v_estimate_pct >= 40 OR v_delta_pct_out >= -25 THEN 'Lively'
      ELSE 'Quiet'
    END;
  END IF;

  -- STEP 7: band (unchanged)
  v_band_pct := (100 - v_confidence) * 0.40;
  v_estimate_low_out := GREATEST(0, ROUND(v_estimate_int * (1 - v_band_pct / 100.0))::int);
  v_estimate_high_out := ROUND(v_estimate_int * (1 + v_band_pct / 100.0))::int;

  -- STEP 8: trend (unchanged)
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
    v_trend_rate_out := ROUND((v_estimate_int - v_prior_estimate)::numeric / v_minutes_since_prior, 2);
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

  PERFORM public.detect_and_record_events(
    p_venue_id := p_venue_id,
    p_current_estimate := v_estimate_int,
    p_current_state_label := v_state,
    p_prior_estimate := v_prior_estimate,
    p_capacity_pct := v_capacity_pct_out);

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
    v_signal_breakdown || jsonb_build_object(
      'baseline_source', v_baseline_source,
      'baseline_pct', round(v_baseline_pct, 1),
      'expected_pct', v_expected_pct_for_curve,
      'expected_pct_used', v_expected_pct_out,
      'fallback_to_category_default', (v_expected_pct_for_curve IS NULL OR v_expected_pct_for_curve <= 0),
      'signal_component', round(v_signal_component, 2),
      'live_busyness_pct', v_live_pct,
      'forecast_busyness_pct', v_forecast_busyness,
      'manual_busyness_pct', v_manual_busyness,
      'total_signals_in_window', v_signal_count,
      'newest_signal_age_minutes',
        CASE WHEN v_newest_signal_at IS NULL THEN NULL
             ELSE round(EXTRACT(EPOCH FROM (now() - v_newest_signal_at)) / 60.0, 1) END),
    v_delta_pct_out,
    v_expected_pct_out;
END;
$$;


ALTER FUNCTION "public"."compute_venue_estimate"("p_venue_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_time_band"() RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_local TIMESTAMP;
  v_dow INTEGER;
  v_hour INTEGER;
  v_is_weekend BOOLEAN;
  v_is_peak BOOLEAN;
BEGIN
  v_local := (now() AT TIME ZONE 'America/New_York');
  v_dow := EXTRACT(DOW FROM v_local)::INTEGER;
  v_hour := EXTRACT(HOUR FROM v_local)::INTEGER;

  -- Weekend = Fri (5) or Sat (6). Sunday early-morning hours count as Sat night.
  v_is_weekend := v_dow IN (5, 6) OR (v_dow = 0 AND v_hour < 4);

  -- Peak = 9pm-close (9pm-4am). Early = 5pm-9pm.
  v_is_peak := v_hour >= 21 OR v_hour < 4;

  IF v_is_weekend AND v_is_peak THEN
    RETURN 'wknd_peak';
  ELSIF v_is_weekend THEN
    RETURN 'wknd_early';
  ELSIF v_is_peak THEN
    RETURN 'wk_peak';
  ELSE
    RETURN 'wk_early';
  END IF;
END;
$$;


ALTER FUNCTION "public"."current_time_band"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decrement_headcount"("target_venue" "uuid", "target_city" character varying, "target_night" "date", "staff_user" "uuid" DEFAULT NULL::"uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  new_count INTEGER;
BEGIN
  UPDATE headcounts SET
    current_count = GREATEST(current_count - 1, 0),
    updated_at = NOW(),
    last_updated_by = staff_user
  WHERE venue_id = target_venue AND night_of = target_night
  RETURNING current_count INTO new_count;

  IF new_count IS NULL THEN new_count := 0; END IF;

  -- ── PREDICTION ENGINE: write bouncer_headcount signal ──
  PERFORM public.record_signal(
    target_venue,
    staff_user,
    'bouncer_headcount',
    new_count,
    NULL,
    NULL,
    jsonb_build_object('action', 'decrement', 'count', new_count, 'night_of', target_night)
  );

  RETURN json_build_object('new_count', new_count);
END;
$$;


ALTER FUNCTION "public"."decrement_headcount"("target_venue" "uuid", "target_city" character varying, "target_night" "date", "staff_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_user_account"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  DELETE FROM loyalty_visits WHERE user_id = auth.uid();
  DELETE FROM cover_purchases WHERE user_id = auth.uid();
  DELETE FROM loyalty_redemptions WHERE user_id = auth.uid();
  DELETE FROM push_tokens WHERE user_id = auth.uid();
  DELETE FROM profiles WHERE auth_id = auth.uid();
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;


ALTER FUNCTION "public"."delete_user_account"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."derive_true_state"("p_count" integer, "p_effective_capacity" integer) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT CASE
    WHEN p_effective_capacity IS NULL OR p_effective_capacity <= 0 THEN NULL
    WHEN p_count::numeric / p_effective_capacity >= 0.85 THEN 'Packed'
    WHEN p_count::numeric / p_effective_capacity >= 0.60 THEN 'Busy'
    WHEN p_count::numeric / p_effective_capacity >= 0.30 THEN 'Lively'
    ELSE 'Quiet'
  END;
$$;


ALTER FUNCTION "public"."derive_true_state"("p_count" integer, "p_effective_capacity" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."detect_and_record_events"("p_venue_id" "uuid", "p_current_estimate" integer, "p_current_state_label" "text", "p_prior_estimate" integer, "p_capacity_pct" numeric) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_city text;
  v_venue_name text;
  v_today_anchor timestamptz;
  v_today_surge_count int;
  v_venue_recent int;
  v_recent_rise int;
  v_recent_taps int;
  v_recent_pulse int;
  v_pct_change numeric;
BEGIN
  SELECT city, name INTO v_city, v_venue_name
  FROM public.venues WHERE id = p_venue_id;

  IF v_city IS NULL OR v_city NOT IN ('knoxville', 'tampa', 'st_petersburg') THEN
    RETURN;
  END IF;

  -- "Today" for nightlife purposes = the local-ET 5pm boundary.
  -- date_trunc('day', ...) at America/New_York gives midnight local; add 17h.
  v_today_anchor := (date_trunc('day', now() AT TIME ZONE 'America/New_York') + interval '17 hours')
    AT TIME ZONE 'America/New_York';

  -- ── EVENT 1: surge_first ───────────────────────────────────────
  -- Only the first Surging in the city since 5pm local. Per-venue
  -- 6-hour cooldown also applies (so a flapping venue can't re-fire
  -- after the city's quota resets).
  IF p_current_state_label = 'Surging' THEN
    SELECT COUNT(*) INTO v_today_surge_count
    FROM public.live_events
    WHERE city = v_city
      AND event_type = 'surge_first'
      AND fired_at > v_today_anchor;

    SELECT COUNT(*) INTO v_venue_recent
    FROM public.live_events
    WHERE venue_id = p_venue_id
      AND event_type = 'surge_first'
      AND fired_at > now() - interval '6 hours';

    IF v_today_surge_count = 0 AND v_venue_recent = 0 THEN
      INSERT INTO public.live_events (event_type, venue_id, city, payload)
      VALUES (
        'surge_first', p_venue_id, v_city,
        jsonb_build_object(
          'venue_name', v_venue_name,
          'estimate', p_current_estimate,
          'capacity_pct', p_capacity_pct,
          'message', 'first surging tonight'
        )
      );
    END IF;
  END IF;

  -- ── EVENT 2: surge_rapid_rise ──────────────────────────────────
  -- Estimate jumped 30 % over a meaningful base in one fusion cycle.
  -- Skip on first cycle (no prior_estimate).
  IF p_prior_estimate IS NOT NULL
     AND p_prior_estimate >= 30
     AND p_current_estimate >= p_prior_estimate * 1.30 THEN

    SELECT COUNT(*) INTO v_recent_rise
    FROM public.live_events
    WHERE venue_id = p_venue_id
      AND event_type = 'surge_rapid_rise'
      AND fired_at > now() - interval '30 minutes';

    IF v_recent_rise = 0 THEN
      v_pct_change := round(((p_current_estimate - p_prior_estimate)::numeric / p_prior_estimate) * 100, 0);

      INSERT INTO public.live_events (event_type, venue_id, city, payload)
      VALUES (
        'surge_rapid_rise', p_venue_id, v_city,
        jsonb_build_object(
          'venue_name', v_venue_name,
          'estimate', p_current_estimate,
          'prior_estimate', p_prior_estimate,
          'pct_change', v_pct_change,
          'message', 'rising fast'
        )
      );
    END IF;
  END IF;

  -- ── EVENT 3: social_pulse ──────────────────────────────────────
  -- 5+ NFC taps OR cover purchases for this venue in the last 10 min.
  SELECT COUNT(*) INTO v_recent_taps
  FROM public.headcount_signals
  WHERE venue_id = p_venue_id
    AND signal_type IN ('nfc_tap', 'cover_purchase')
    AND created_at > now() - interval '10 minutes';

  IF v_recent_taps >= 5 THEN
    SELECT COUNT(*) INTO v_recent_pulse
    FROM public.live_events
    WHERE venue_id = p_venue_id
      AND event_type = 'social_pulse'
      AND fired_at > now() - interval '20 minutes';

    IF v_recent_pulse = 0 THEN
      INSERT INTO public.live_events (event_type, venue_id, city, payload)
      VALUES (
        'social_pulse', p_venue_id, v_city,
        jsonb_build_object(
          'venue_name', v_venue_name,
          'tap_count', v_recent_taps,
          'message', 'people are arriving'
        )
      );
    END IF;
  END IF;
END;
$$;


ALTER FUNCTION "public"."detect_and_record_events"("p_venue_id" "uuid", "p_current_estimate" integer, "p_current_state_label" "text", "p_prior_estimate" integer, "p_capacity_pct" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."evaluate_bouncer_truth_signal"("p_signal_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_signal_row record;
  v_venue_row record;
  v_pred record;
  v_log_id uuid;
  v_bouncer_count integer;
  v_effective_capacity integer;
  v_true_state text;
  v_true_capacity_pct numeric;
  v_predicted_state text;
  v_predicted_rank integer;
  v_true_rank integer;
  v_distance integer;
  v_match_score numeric;
  v_match_kind text;
  v_prediction_age_sec integer;
BEGIN
  -- 1. Load the bouncer signal
  SELECT venue_id, signal_value, recorded_at, metadata
  INTO v_signal_row
  FROM public.headcount_signals
  WHERE id = p_signal_id AND signal_type = 'bouncer_headcount';

  IF v_signal_row IS NULL THEN
    RAISE WARNING 'evaluate_bouncer_truth_signal: signal % not found or not a bouncer signal', p_signal_id;
    RETURN NULL;
  END IF;

  v_bouncer_count := v_signal_row.signal_value::integer;

  -- 2. Load venue + capacity. Skip if no capacity available.
  SELECT id, effective_capacity, capacity
  INTO v_venue_row
  FROM public.venues
  WHERE id = v_signal_row.venue_id;

  v_effective_capacity := COALESCE(v_venue_row.effective_capacity, v_venue_row.capacity);

  -- If no capacity, log as unmeasurable and return
  IF v_effective_capacity IS NULL OR v_effective_capacity <= 0 THEN
    INSERT INTO public.headcount_accuracy_log (
      venue_id, recorded_at, bouncer_signal_id, bouncer_count,
      match_kind, notes
    ) VALUES (
      v_signal_row.venue_id, v_signal_row.recorded_at, p_signal_id, v_bouncer_count,
      'unmeasurable', 'no effective_capacity -- cannot derive true state'
    )
    RETURNING id INTO v_log_id;
    RETURN v_log_id;
  END IF;

  -- 3. Derive ground truth
  v_true_state := public.derive_true_state(v_bouncer_count, v_effective_capacity);
  v_true_capacity_pct := v_bouncer_count::numeric / v_effective_capacity;

  -- 4. Find the engine's most recent prediction within 10 minutes BEFORE
  --    the bouncer signal. Critically: must be BEFORE the bouncer signal,
  --    not after -- we're testing whether the engine predicted correctly,
  --    not whether it adjusted after the truth landed.
  --    Also: must not be a bouncer-override prediction (that's circular --
  --    the engine just echoed an earlier bouncer click).
  SELECT estimate, state_label, delta_pct, confidence_pct,
         source_breakdown->>'baseline_source' AS baseline_source,
         active_signal_count, source_breakdown,
         EXTRACT(EPOCH FROM (v_signal_row.recorded_at - computed_at))::integer AS age_sec
  INTO v_pred
  FROM public.headcount_estimates_history
  WHERE venue_id = v_signal_row.venue_id
    AND computed_at < v_signal_row.recorded_at
    AND computed_at >= v_signal_row.recorded_at - interval '10 minutes'
    AND override_active = false   -- don't measure against bouncer-driven predictions
  ORDER BY computed_at DESC
  LIMIT 1;

  -- If no prediction within window, log as unmeasurable
  IF v_pred IS NULL THEN
    INSERT INTO public.headcount_accuracy_log (
      venue_id, recorded_at, bouncer_signal_id, bouncer_count,
      effective_capacity_at_truth, true_state, true_capacity_pct,
      match_kind, notes
    ) VALUES (
      v_signal_row.venue_id, v_signal_row.recorded_at, p_signal_id, v_bouncer_count,
      v_effective_capacity, v_true_state, v_true_capacity_pct,
      'unmeasurable', 'no engine prediction within 10-min lookback'
    )
    RETURNING id INTO v_log_id;
    RETURN v_log_id;
  END IF;

  v_predicted_state := v_pred.state_label;
  v_prediction_age_sec := v_pred.age_sec;

  -- 5. Score the match
  v_predicted_rank := public.state_label_rank(v_predicted_state);
  v_true_rank := public.state_label_rank(v_true_state);

  IF v_predicted_rank IS NULL OR v_true_rank IS NULL THEN
    -- One side is Unknown or unrecognized -- score as a miss
    v_distance := NULL;
    v_match_score := 0.0;
    v_match_kind := CASE
      WHEN v_predicted_state = 'Unknown' THEN 'unknown_prediction'
      ELSE 'miss'
    END;
  ELSE
    v_distance := ABS(v_predicted_rank - v_true_rank);
    v_match_score := CASE
      WHEN v_distance = 0 THEN 1.0
      WHEN v_distance = 1 THEN 0.5
      ELSE 0.0
    END;
    v_match_kind := CASE
      WHEN v_distance = 0 THEN 'exact'
      WHEN v_distance = 1 THEN 'one_step'
      ELSE 'miss'
    END;
  END IF;

  -- 6. Insert the log row
  INSERT INTO public.headcount_accuracy_log (
    venue_id, recorded_at, bouncer_signal_id, bouncer_count,
    effective_capacity_at_truth,
    predicted_estimate, predicted_state, predicted_delta_pct,
    predicted_confidence_pct, predicted_baseline_source,
    prediction_age_seconds,
    true_state, true_capacity_pct,
    match_score, match_kind, state_distance,
    signals_active_count, signals_breakdown
  ) VALUES (
    v_signal_row.venue_id, v_signal_row.recorded_at, p_signal_id, v_bouncer_count,
    v_effective_capacity,
    v_pred.estimate, v_predicted_state, v_pred.delta_pct,
    v_pred.confidence_pct, v_pred.baseline_source,
    v_prediction_age_sec,
    v_true_state, v_true_capacity_pct,
    v_match_score, v_match_kind, v_distance,
    v_pred.active_signal_count, v_pred.source_breakdown
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
EXCEPTION WHEN OTHERS THEN
  -- Never let evaluator failure break the parent transaction
  RAISE WARNING 'evaluate_bouncer_truth_signal failed: % %', SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."evaluate_bouncer_truth_signal"("p_signal_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_stale_paint_prompts"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE v_count integer := 0;
BEGIN
  UPDATE public.paint_prompts
  SET status = 'expired', expired_at = now()
  WHERE status = 'queued' AND queued_at < now() - interval '3 hours';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.paint_prompts
  SET status = 'expired', expired_at = now()
  WHERE status = 'pushed' AND pushed_at < now() - interval '24 hours';

  RETURN v_count;
END $$;


ALTER FUNCTION "public"."expire_stale_paint_prompts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_dangling_enters"("p_cutoff" timestamp with time zone, "p_stalemark" timestamp with time zone) RETURNS TABLE("user_id" "uuid", "venue_id" "uuid", "entered_at" timestamp with time zone, "last_seen_at" timestamp with time zone)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH enters AS (
    SELECT pe.user_id, pe.venue_id, MIN(pe.created_at) AS entered_at
      FROM public.presence_events pe
     WHERE pe.event_type = 'enter'
       AND pe.created_at < p_cutoff
       AND pe.created_at > p_cutoff - INTERVAL '12 hours'
     GROUP BY pe.user_id, pe.venue_id
  ),
  last_seens AS (
    SELECT pe.user_id, pe.venue_id, MAX(pe.created_at) AS last_seen_at
      FROM public.presence_events pe
     WHERE pe.created_at > p_cutoff - INTERVAL '12 hours'
       AND pe.event_type IN ('enter', 'still_present')
     GROUP BY pe.user_id, pe.venue_id
  ),
  exits AS (
    SELECT DISTINCT pe.user_id, pe.venue_id
      FROM public.presence_events pe
     WHERE pe.event_type = 'exit'
       AND pe.created_at > p_cutoff - INTERVAL '12 hours'
  )
  SELECT e.user_id, e.venue_id, e.entered_at, ls.last_seen_at
    FROM enters e
    JOIN last_seens ls
      ON ls.user_id = e.user_id AND ls.venue_id = e.venue_id
    LEFT JOIN exits ex
      ON ex.user_id = e.user_id AND ex.venue_id = e.venue_id
   WHERE ex.user_id IS NULL
     AND ls.last_seen_at < p_stalemark
     AND NOT EXISTS (
       SELECT 1 FROM public.user_visits uv
        WHERE uv.user_id = e.user_id
          AND uv.venue_id = e.venue_id
          AND uv.night_of = (
            CASE WHEN EXTRACT(HOUR FROM e.entered_at) < 8
                 THEN (e.entered_at - INTERVAL '1 day')::date
                 ELSE e.entered_at::date END
          )
     );
$$;


ALTER FUNCTION "public"."find_dangling_enters"("p_cutoff" timestamp with time zone, "p_stalemark" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fuse_all_active_venues"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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
    -- Per-venue isolation: a throw here is caught, logged, and skipped
    -- so one bad venue can never roll back the whole batch.
    BEGIN
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
    EXCEPTION
      WHEN OTHERS THEN
        -- Swallow: skip this venue, keep the batch alive. Do NOT re-raise,
        -- do NOT increment v_count. Visible in logs for diagnosis.
        RAISE WARNING 'fuse_all_active_venues: skipped venue % — %',
          v_venue.id, SQLERRM;
    END;
  END LOOP;

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."fuse_all_active_venues"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_active_signals"("p_venue_id" "uuid", "p_since_minutes" integer DEFAULT 90) RETURNS TABLE("signal_type" "text", "signal_value" numeric, "weight" numeric, "age_minutes" numeric, "expires_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT
    s.signal_type,
    s.signal_value,
    w.weight,
    EXTRACT(EPOCH FROM (now() - s.recorded_at)) / 60.0 AS age_minutes,
    s.expires_at
  FROM public.headcount_signals s
  LEFT JOIN public.signal_weights w ON w.signal_type = s.signal_type
  WHERE s.venue_id = p_venue_id
    AND s.recorded_at > now() - (p_since_minutes || ' minutes')::interval
    AND s.expires_at > now()
  ORDER BY s.recorded_at DESC;
$$;


ALTER FUNCTION "public"."get_active_signals"("p_venue_id" "uuid", "p_since_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_current_hour_from_curve"("p_venue_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_curve jsonb;
  v_local_now timestamp;
  v_hour int;
  v_pg_dow int;
  v_bt_day_int int;
  v_day jsonb;
  v_value text;
BEGIN
  SELECT popular_times_curve INTO v_curve
  FROM public.venue_baselines WHERE venue_id = p_venue_id;

  IF v_curve IS NULL OR v_curve->'analysis' IS NULL THEN
    RETURN NULL;
  END IF;

  v_local_now := (now() AT TIME ZONE 'America/New_York');
  v_hour := EXTRACT(HOUR FROM v_local_now)::int;
  v_pg_dow := EXTRACT(DOW FROM v_local_now)::int;
  v_bt_day_int := (v_pg_dow + 6) % 7;

  SELECT d INTO v_day
  FROM jsonb_array_elements(v_curve->'analysis') AS d
  WHERE (d->>'day_int')::int = v_bt_day_int
  LIMIT 1;

  IF v_day IS NULL THEN
    RETURN NULL;
  END IF;

  v_value := (v_day->'day_raw')->>v_hour;
  IF v_value IS NULL OR v_value = 'null' THEN
    RETURN NULL;
  END IF;

  RETURN v_value::int;
END;
$$;


ALTER FUNCTION "public"."get_current_hour_from_curve"("p_venue_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_current_hour_from_manual_curve"("p_venue_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_curve      jsonb;
  v_local_now  timestamp;
  v_hour       int;
  v_minute     int;
  v_pg_dow     int;
  v_day_key    text;
  v_day_array  jsonb;
  v_cur_txt    text;
  v_next_txt   text;
  v_cur_val    numeric;
  v_next_val   numeric;
  v_frac       numeric;
  v_result     numeric;
BEGIN
  -- Read the manual operator curve. CHANGE #1: learned_curve, not the
  -- phantom 'manual_curve' column the prior live body referenced.
  SELECT learned_curve INTO v_curve
  FROM public.venue_baselines WHERE venue_id = p_venue_id;

  -- Shape guard: missing or non-object curve → fall through cleanly.
  IF v_curve IS NULL OR jsonb_typeof(v_curve) <> 'object' THEN
    RETURN NULL;
  END IF;

  v_local_now := (now() AT TIME ZONE 'America/New_York');
  v_hour      := EXTRACT(HOUR   FROM v_local_now)::int;   -- 0..23
  v_minute    := EXTRACT(MINUTE FROM v_local_now)::int;   -- 0..59
  v_pg_dow    := EXTRACT(DOW    FROM v_local_now)::int;   -- 0=Sun..6=Sat

  -- Operator day_int: Monday=0 … Saturday=5, Sunday=6.
  -- (pg_dow + 6) % 7 — identical convention to get_current_hour_from_curve.
  v_day_key := ((v_pg_dow + 6) % 7)::text;

  -- Day array guard: missing or non-array → fall through cleanly.
  v_day_array := v_curve -> v_day_key;
  IF v_day_array IS NULL OR jsonb_typeof(v_day_array) <> 'array' THEN
    RETURN NULL;
  END IF;

  -- Current hour's value. Missing/null → fall through (no manual datum
  -- for this hour means defer to the next tier, not assert "0% busy").
  v_cur_txt := v_day_array ->> v_hour;
  IF v_cur_txt IS NULL OR v_cur_txt = 'null' THEN
    RETURN NULL;
  END IF;
  v_cur_val := v_cur_txt::numeric;

  -- CHANGE #2 (midnight handling): hour 23 has no in-day next hour.
  -- Return flat — no cross-day lookup, no smear across the boundary.
  IF v_hour >= 23 THEN
    RETURN ROUND(v_cur_val)::int;
  END IF;

  -- Next hour's value. Missing/null → return current hour flat.
  v_next_txt := v_day_array ->> (v_hour + 1);
  IF v_next_txt IS NULL OR v_next_txt = 'null' THEN
    RETURN ROUND(v_cur_val)::int;
  END IF;
  v_next_val := v_next_txt::numeric;

  -- CHANGE #2 (interpolation): blend by minutes elapsed in the hour.
  -- e.g. 10:30 → halfway between h10 and h11.
  v_frac   := v_minute::numeric / 60.0;
  v_result := v_cur_val + (v_next_val - v_cur_val) * v_frac;

  RETURN ROUND(v_result)::int;

EXCEPTION
  -- CHANGE #3: any unforeseen parse/type error → NULL, never raise.
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."get_current_hour_from_manual_curve"("p_venue_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_venue_baseline_hue"("p_venue_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_baseline JSONB;
  v_band TEXT;
  v_hue INTEGER;
BEGIN
  SELECT vibe_hue_baseline INTO v_baseline FROM public.venues WHERE id = p_venue_id;
  IF v_baseline IS NULL THEN RETURN NULL; END IF;

  v_band := public.current_time_band();
  v_hue := (v_baseline->>v_band)::INTEGER;

  RETURN v_hue;
END;
$$;


ALTER FUNCTION "public"."get_venue_baseline_hue"("p_venue_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_venue_current_hue"("p_venue_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
  v_canonical_id integer;
  v_canonical_deg integer;
  v_sum_cos numeric := 0;
  v_sum_sin numeric := 0;
  v_total_weight numeric := 0;
  v_mean_rad numeric;
  v_mean_deg numeric;
  v_best_hue_id integer;
  v_best_distance numeric := 9999;
  hue_row record;
  paint_row record;
  STABILITY_ANCHOR constant numeric := 3.0;
  DECAY_HALF_LIFE_HOURS constant numeric := 24.0;
  DECAY_K constant numeric := 0.6931471805599453 / 24.0;  -- ln(2) / half-life
BEGIN
  -- 1. Read canonical hue + its spectrum degrees.
  SELECT v.canonical_hue_id, h.hsl_degrees
  INTO v_canonical_id, v_canonical_deg
  FROM public.venues v
  LEFT JOIN public.vibe_hue_lookup h ON h.hue_id = v.canonical_hue_id
  WHERE v.id = p_venue_id;

  IF v_canonical_id IS NULL THEN
    RETURN 7;  -- safety default
  END IF;

  -- 2. Canonical contributes as the stability anchor.
  v_sum_cos := v_sum_cos + cos(radians(v_canonical_deg)) * STABILITY_ANCHOR;
  v_sum_sin := v_sum_sin + sin(radians(v_canonical_deg)) * STABILITY_ANCHOR;
  v_total_weight := v_total_weight + STABILITY_ANCHOR;

  -- 3. Each paint contributes with exponential recency decay.
  --    Look back 30 days max (anything older is noise after 24hr half-life).
  FOR paint_row IN
    SELECT h.hsl_degrees, EXTRACT(EPOCH FROM (now() - vr.painted_at)) / 3600.0 AS elapsed_hours
    FROM public.vibe_ratings vr
    JOIN public.vibe_hue_lookup h ON h.hue_id = vr.hue_id
    WHERE vr.venue_id = p_venue_id
      AND vr.painted_at > now() - interval '30 days'
  LOOP
    DECLARE
      v_weight numeric;
    BEGIN
      v_weight := exp(-DECAY_K * paint_row.elapsed_hours);
      v_sum_cos := v_sum_cos + cos(radians(paint_row.hsl_degrees)) * v_weight;
      v_sum_sin := v_sum_sin + sin(radians(paint_row.hsl_degrees)) * v_weight;
      v_total_weight := v_total_weight + v_weight;
    END;
  END LOOP;

  -- 4. Circular mean → degrees.
  v_mean_rad := atan2(v_sum_sin, v_sum_cos);
  v_mean_deg := degrees(v_mean_rad);
  IF v_mean_deg < 0 THEN v_mean_deg := v_mean_deg + 360; END IF;

  -- 5. Find nearest hue on the 14-hue spectrum (circular distance).
  FOR hue_row IN SELECT hue_id, hsl_degrees FROM public.vibe_hue_lookup
  LOOP
    DECLARE
      d numeric;
    BEGIN
      d := abs(hue_row.hsl_degrees - v_mean_deg);
      IF d > 180 THEN d := 360 - d; END IF;
      IF d < v_best_distance THEN
        v_best_distance := d;
        v_best_hue_id := hue_row.hue_id;
      END IF;
    END;
  END LOOP;

  RETURN v_best_hue_id;
END $$;


ALTER FUNCTION "public"."get_venue_current_hue"("p_venue_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_venue_current_hue_degrees"("p_venue_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
  v_canonical_id integer;
  v_canonical_deg integer;
  v_sum_cos numeric := 0;
  v_sum_sin numeric := 0;
  v_total_weight numeric := 0;
  v_mean_rad numeric;
  v_mean_deg numeric;
  paint_row record;
  STABILITY_ANCHOR constant numeric := 3.0;
  DECAY_HALF_LIFE_HOURS constant numeric := 24.0;
  DECAY_K constant numeric := 0.6931471805599453 / 24.0;
BEGIN
  SELECT v.canonical_hue_id, h.hsl_degrees
  INTO v_canonical_id, v_canonical_deg
  FROM public.venues v
  LEFT JOIN public.vibe_hue_lookup h ON h.hue_id = v.canonical_hue_id
  WHERE v.id = p_venue_id;

  IF v_canonical_id IS NULL THEN
    RETURN 45.0;
  END IF;

  v_sum_cos := v_sum_cos + cos(radians(v_canonical_deg)) * STABILITY_ANCHOR;
  v_sum_sin := v_sum_sin + sin(radians(v_canonical_deg)) * STABILITY_ANCHOR;
  v_total_weight := v_total_weight + STABILITY_ANCHOR;

  FOR paint_row IN
    SELECT h.hsl_degrees, EXTRACT(EPOCH FROM (now() - vr.painted_at)) / 3600.0 AS elapsed_hours
    FROM public.vibe_ratings vr
    JOIN public.vibe_hue_lookup h ON h.hue_id = vr.hue_id
    WHERE vr.venue_id = p_venue_id
      AND vr.painted_at > now() - interval '30 days'
  LOOP
    DECLARE
      v_weight numeric;
    BEGIN
      v_weight := exp(-DECAY_K * paint_row.elapsed_hours);
      v_sum_cos := v_sum_cos + cos(radians(paint_row.hsl_degrees)) * v_weight;
      v_sum_sin := v_sum_sin + sin(radians(paint_row.hsl_degrees)) * v_weight;
      v_total_weight := v_total_weight + v_weight;
    END;
  END LOOP;

  v_mean_rad := atan2(v_sum_sin, v_sum_cos);
  v_mean_deg := degrees(v_mean_rad);
  IF v_mean_deg < 0 THEN
    v_mean_deg := v_mean_deg + 360;
  END IF;

  RETURN v_mean_deg;
END $$;


ALTER FUNCTION "public"."get_venue_current_hue_degrees"("p_venue_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_vibe_canvas_points"("p_city" "text") RETURNS TABLE("venue_id" "uuid", "lat" numeric, "lng" numeric, "hue_degrees" numeric, "saturation_pct" integer, "intensity" numeric, "state_label" "text", "paint_count" bigint)
    LANGUAGE "sql" STABLE
    AS $$
  WITH venue_data AS (
    SELECT
      v.id AS venue_id,
      v.lat,
      v.lng,
      public.get_venue_current_hue_degrees(v.id) AS hue_deg,
      (
        SELECT COUNT(*)::bigint
        FROM public.vibe_ratings vr
        WHERE vr.venue_id = v.id
      ) AS paint_count,
      COALESCE(he.state_label, 'Unknown') AS state_label
    FROM public.venues v
    LEFT JOIN public.headcount_estimates he ON he.venue_id = v.id
    WHERE v.is_active = true
      AND v.lat IS NOT NULL
      AND v.lng IS NOT NULL
      AND (p_city IS NULL OR v.city ILIKE '%' || p_city || '%')
  )
  SELECT
    vd.venue_id,
    vd.lat,
    vd.lng,
    -- Continuous hue degrees (soul-true, unsnapped)
    vd.hue_deg AS hue_degrees,
    -- Earned-vibe saturation: 55% canonical baseline, +4% per paint, cap at 95%
    LEAST(95, 55 + 4 * LEAST(vd.paint_count, 10))::integer AS saturation_pct,
    1.0::numeric AS intensity,
    vd.state_label,
    vd.paint_count
  FROM venue_data vd
$$;


ALTER FUNCTION "public"."get_vibe_canvas_points"("p_city" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."headcount_estimates_log_to_history"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO public.headcount_estimates_history (
    venue_id,
    estimate, estimate_low, estimate_high,
    confidence, confidence_pct,
    capacity_pct,
    state_label, trend, trend_rate,
    baseline_component, signal_component,
    override_active, override_expires_at,
    dominant_signal_source, active_signal_count,
    last_signal_at,
    source_breakdown,
    computed_at,
    last_calculated_at, updated_at,
    delta_pct, expected_pct
  ) VALUES (
    NEW.venue_id,
    NEW.estimate, NEW.estimate_low, NEW.estimate_high,
    NEW.confidence, NEW.confidence_pct,
    NEW.capacity_pct,
    NEW.state_label, NEW.trend, NEW.trend_rate,
    NEW.baseline_component, NEW.signal_component,
    NEW.override_active, NEW.override_expires_at,
    NEW.dominant_signal_source, NEW.active_signal_count,
    NEW.last_signal_at,
    NEW.source_breakdown,
    NEW.computed_at,
    NEW.last_calculated_at, NEW.updated_at,
    NEW.delta_pct, NEW.expected_pct
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."headcount_estimates_log_to_history"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."headcount_signals_evaluate_bouncer"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.signal_type = 'bouncer_headcount' THEN
    -- Fire-and-forget: failure shouldn't break the signal insert
    BEGIN
      PERFORM public.evaluate_bouncer_truth_signal(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'bouncer evaluator trigger failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."headcount_signals_evaluate_bouncer"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_headcount"("target_venue" "uuid", "target_city" character varying, "target_night" "date", "staff_user" "uuid" DEFAULT NULL::"uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  new_count INTEGER;
  new_peak INTEGER;
  hc_id uuid;
BEGIN
  INSERT INTO headcounts (venue_id, city, night_of, current_count, peak_count, last_updated_by, is_live)
  VALUES (target_venue, target_city, target_night, 1, 1, staff_user, true)
  ON CONFLICT (venue_id, night_of) DO UPDATE SET
    current_count = headcounts.current_count + 1,
    peak_count = GREATEST(headcounts.peak_count, headcounts.current_count + 1),
    updated_at = NOW(),
    last_updated_by = staff_user,
    is_live = true
  RETURNING id, current_count, peak_count INTO hc_id, new_count, new_peak;

  UPDATE venues SET is_clicker_live = true WHERE id = target_venue;

  -- ── PREDICTION ENGINE: write bouncer_headcount signal ──
  PERFORM public.record_signal(
    target_venue,
    staff_user,
    'bouncer_headcount',
    new_count,
    NULL,
    NULL,
    jsonb_build_object('action', 'increment', 'count', new_count, 'peak', new_peak, 'night_of', target_night)
  );

  RETURN json_build_object('new_count', new_count, 'peak', new_peak);
END;
$$;


ALTER FUNCTION "public"."increment_headcount"("target_venue" "uuid", "target_city" character varying, "target_night" "date", "staff_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_paint"("p_venue_id" "uuid", "p_hue_id" integer, "p_visit_first_seen_at" timestamp with time zone, "p_paint_prompt_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_auth_uid uuid;
  v_time_band text;
  v_eastern_ts timestamptz;
  v_dow integer;
  v_hour integer;
  v_rating_id uuid;
BEGIN
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Compute time_band (US Eastern). Matches public.current_time_band().
  v_eastern_ts := p_visit_first_seen_at AT TIME ZONE 'America/New_York';
  v_dow := EXTRACT(DOW FROM v_eastern_ts)::int;
  v_hour := EXTRACT(HOUR FROM v_eastern_ts)::int;

  IF v_dow BETWEEN 5 AND 6 THEN
    IF v_hour >= 17 AND v_hour < 21 THEN
      v_time_band := 'wknd_early';
    ELSE
      v_time_band := 'wknd_peak';
    END IF;
  ELSE
    IF v_hour >= 17 AND v_hour < 21 THEN
      v_time_band := 'wk_early';
    ELSE
      v_time_band := 'wk_peak';
    END IF;
  END IF;

  -- INSERT vibe_ratings with auth.uid() as user_id (matches Phase A schema)
  INSERT INTO public.vibe_ratings (user_id, venue_id, hue_id, time_band)
  VALUES (v_auth_uid, p_venue_id, p_hue_id, v_time_band)
  RETURNING id INTO v_rating_id;

  -- Link paint_prompt (its user_id is profiles.id; we look it up via auth_id)
  IF p_paint_prompt_id IS NOT NULL THEN
    UPDATE public.paint_prompts
    SET status = 'painted',
        painted_at = now(),
        vibe_rating_id = v_rating_id
    WHERE id = p_paint_prompt_id;
  END IF;

  RETURN v_rating_id;
EXCEPTION
  WHEN unique_violation THEN
    SELECT id INTO v_rating_id
    FROM public.vibe_ratings
    WHERE user_id = v_auth_uid AND venue_id = p_venue_id
    LIMIT 1;
    
    IF p_paint_prompt_id IS NOT NULL AND v_rating_id IS NOT NULL THEN
      UPDATE public.paint_prompts
      SET status = 'painted',
          painted_at = now(),
          vibe_rating_id = v_rating_id
      WHERE id = p_paint_prompt_id AND status != 'painted';
    END IF;
    
    RETURN v_rating_id;
END $$;


ALTER FUNCTION "public"."record_paint"("p_venue_id" "uuid", "p_hue_id" integer, "p_visit_first_seen_at" timestamp with time zone, "p_paint_prompt_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_signal"("p_venue_id" "uuid", "p_user_id" "uuid", "p_signal_type" "text", "p_signal_value" numeric DEFAULT 1.0, "p_source_table" "text" DEFAULT NULL::"text", "p_source_row_id" "uuid" DEFAULT NULL::"uuid", "p_metadata" "jsonb" DEFAULT NULL::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_ttl_seconds integer;
  v_signal_id uuid;
BEGIN
  IF p_venue_id IS NULL OR p_signal_type IS NULL THEN
    RETURN NULL;
  END IF;

  -- Look up TTL for this signal type. If not found, fall back to 1 hour.
  SELECT ttl_seconds INTO v_ttl_seconds
  FROM public.signal_weights WHERE signal_type = p_signal_type;

  IF v_ttl_seconds IS NULL THEN
    v_ttl_seconds := 3600;
  END IF;

  -- Dedup: if source_table + source_row_id + signal_type already exist, skip.
  IF p_source_table IS NOT NULL AND p_source_row_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.headcount_signals
      WHERE source_table = p_source_table
        AND source_row_id = p_source_row_id
        AND signal_type = p_signal_type
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO public.headcount_signals (
    venue_id, user_id, signal_type, signal_value,
    recorded_at, expires_at, source_table, source_row_id, metadata
  ) VALUES (
    p_venue_id, p_user_id, p_signal_type, p_signal_value,
    now(), now() + (v_ttl_seconds || ' seconds')::interval,
    p_source_table, p_source_row_id, p_metadata
  )
  RETURNING id INTO v_signal_id;

  RETURN v_signal_id;
EXCEPTION WHEN OTHERS THEN
  -- Never let a signal-write failure break the parent transaction
  RAISE WARNING 'record_signal failed: % %', SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."record_signal"("p_venue_id" "uuid", "p_user_id" "uuid", "p_signal_type" "text", "p_signal_value" numeric, "p_source_table" "text", "p_source_row_id" "uuid", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_venue_checkin"("p_user_id" "uuid", "p_venue_id" "uuid", "p_source" "text", "p_user_lat" numeric, "p_user_lng" numeric, "p_device_id" "text", "p_nfc_password" "text" DEFAULT NULL::"text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  venue_lat numeric;
  venue_lng numeric;
  venue_loyalty_active boolean;
  venue_nfc_password text;
  venue_radius_meters integer;
  distance_meters numeric;
  already_checked_in boolean;
  recent_checkins integer;
  new_visit_count integer;
  tonight_date date;
  new_visit_id uuid;
BEGIN
  tonight_date := CASE WHEN EXTRACT(HOUR FROM NOW()) < 5
                       THEN (NOW() - INTERVAL '1 day')::date
                       ELSE NOW()::date END;

  SELECT lat, lng, loyalty_active, nfc_password, COALESCE(nfc_radius_meters, 150)
  INTO venue_lat, venue_lng, venue_loyalty_active, venue_nfc_password, venue_radius_meters
  FROM venues WHERE id = p_venue_id;

  IF venue_lat IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'venue_not_found');
  END IF;

  IF venue_loyalty_active IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', 'loyalty_inactive');
  END IF;

  IF p_source = 'nfc' THEN
    IF p_nfc_password IS NULL OR venue_nfc_password IS NULL OR p_nfc_password <> venue_nfc_password THEN
      RETURN json_build_object('success', false, 'error', 'wrong_password');
    END IF;
  END IF;

  distance_meters := 6371000 * acos(
    LEAST(1.0, cos(radians(p_user_lat)) * cos(radians(venue_lat)) *
    cos(radians(venue_lng) - radians(p_user_lng)) +
    sin(radians(p_user_lat)) * sin(radians(venue_lat)))
  );

  IF distance_meters > venue_radius_meters THEN
    RETURN json_build_object('success', false, 'error', 'too_far_from_venue');
  END IF;

  SELECT COUNT(*) INTO recent_checkins
  FROM loyalty_visits
  WHERE user_id = p_user_id
    AND verified_at > NOW() - INTERVAL '10 minutes';
  IF recent_checkins >= 3 THEN
    RETURN json_build_object('success', false, 'error', 'rate_limited');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM loyalty_visits
    WHERE user_id = p_user_id
      AND venue_id = p_venue_id
      AND night_of = tonight_date
  ) INTO already_checked_in;
  IF already_checked_in THEN
    RETURN json_build_object('success', false, 'error', 'already_checked_in_tonight');
  END IF;

  INSERT INTO loyalty_visits (user_id, venue_id, source, night_of, verified_at, device_id)
  VALUES (p_user_id, p_venue_id, p_source, tonight_date, NOW(), p_device_id)
  RETURNING id INTO new_visit_id;

  SELECT COUNT(*) INTO new_visit_count
  FROM loyalty_visits
  WHERE user_id = p_user_id AND venue_id = p_venue_id;

  -- ── PREDICTION ENGINE: write loyalty_visit signal ──
  PERFORM public.record_signal(
    p_venue_id,
    p_user_id,
    CASE WHEN p_source = 'nfc' THEN 'nfc_tap' ELSE 'loyalty_visit' END,
    1.0,
    'loyalty_visits',
    new_visit_id,
    jsonb_build_object('source', p_source, 'distance_meters', distance_meters)
  );

  RETURN json_build_object(
    'success', true,
    'visit_count', new_visit_count,
    'distance_meters', distance_meters
  );
END;
$$;


ALTER FUNCTION "public"."record_venue_checkin"("p_user_id" "uuid", "p_venue_id" "uuid", "p_source" "text", "p_user_lat" numeric, "p_user_lng" numeric, "p_device_id" "text", "p_nfc_password" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."snapshot_venuu_ranks"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
  INSERT INTO rank_snapshots (profile_id, snapshot_date, global_rank, venuu_score)
  SELECT profile_id, (now() AT TIME ZONE 'America/New_York')::date, global_rank, venuu_score
  FROM user_venuu_rank
  ON CONFLICT (profile_id, snapshot_date)
  DO UPDATE SET global_rank = EXCLUDED.global_rank, venuu_score = EXCLUDED.venuu_score;
$$;


ALTER FUNCTION "public"."snapshot_venuu_ranks"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."state_label_rank"("p_state" "text") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT CASE p_state
    WHEN 'Quiet'   THEN 1
    WHEN 'Lively'  THEN 2
    WHEN 'Busy'    THEN 3
    WHEN 'Packed'  THEN 4
    WHEN 'Surging' THEN 5
    ELSE NULL
  END;
$$;


ALTER FUNCTION "public"."state_label_rank"("p_state" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."venue_recaps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "venue_id" "uuid" NOT NULL,
    "username" character varying(24) DEFAULT 'anonymous'::character varying NOT NULL,
    "body" "text" DEFAULT ''::"text",
    "day_of" "date" NOT NULL,
    "photo_url" "text" NOT NULL,
    "hue_at_capture" integer DEFAULT 0 NOT NULL,
    "developed_at" timestamp with time zone DEFAULT ((("date_trunc"('day'::"text", ("now"() AT TIME ZONE 'America/New_York'::"text")) + '1 day'::interval) + '08:00:00'::interval) AT TIME ZONE 'America/New_York'::"text") NOT NULL,
    "user_id" "uuid",
    "user_moment_number" integer,
    CONSTRAINT "venue_recaps_body_check" CHECK (("char_length"("body") <= 200)),
    CONSTRAINT "venue_recaps_hue_at_capture_check" CHECK ((("hue_at_capture" >= 0) AND ("hue_at_capture" <= 360)))
);


ALTER TABLE "public"."venue_recaps" OWNER TO "postgres";


COMMENT ON COLUMN "public"."venue_recaps"."photo_url" IS 'Required. Supabase Storage URL for the captured moment photo.';



COMMENT ON COLUMN "public"."venue_recaps"."hue_at_capture" IS 'Venue current_hue (0-360) at capture time. The paint colors your photo frame forever.';



COMMENT ON COLUMN "public"."venue_recaps"."developed_at" IS 'Default: next 8am ET after creation. Photo private to author until this passes.';



COMMENT ON COLUMN "public"."venue_recaps"."user_id" IS 'Auth user id at insert. ON DELETE CASCADE removes the moment if account is deleted.';



COMMENT ON COLUMN "public"."venue_recaps"."user_moment_number" IS 'The user''s personal count of moments captured. Their 1st = #1, 2nd = #2, etc. Engraved into the JPEG permanently.';



CREATE OR REPLACE FUNCTION "public"."submit_moment"("p_venue_id" "uuid", "p_username" "text", "p_photo_url" "text", "p_hue_at_capture" integer) RETURNS "public"."venue_recaps"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id uuid;
  v_moment_number int;
  v_inserted public.venue_recaps;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF p_username IS NULL OR p_username = '' OR LOWER(p_username) = 'guest' THEN
    RAISE EXCEPTION 'guest_not_allowed' USING ERRCODE = 'P0001';
  END IF;

  IF p_photo_url IS NULL OR p_photo_url = '' THEN
    RAISE EXCEPTION 'photo_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_hue_at_capture < 0 OR p_hue_at_capture > 360 THEN
    RAISE EXCEPTION 'invalid_hue' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.venue_recaps
    WHERE venue_id = p_venue_id AND username = p_username
  ) THEN
    RAISE EXCEPTION 'already_crowned' USING ERRCODE = 'P0001';
  END IF;

  -- Compute user_moment_number atomically inside the transaction.
  SELECT COUNT(*) + 1
  INTO v_moment_number
  FROM public.venue_recaps
  WHERE user_id = v_user_id;

  INSERT INTO public.venue_recaps (
    venue_id, username, body, day_of,
    photo_url, hue_at_capture, user_id,
    user_moment_number
  )
  VALUES (
    p_venue_id, p_username, '', CURRENT_DATE,
    p_photo_url, p_hue_at_capture, v_user_id,
    v_moment_number
  )
  RETURNING * INTO v_inserted;

  RETURN v_inserted;
END;
$$;


ALTER FUNCTION "public"."submit_moment"("p_venue_id" "uuid", "p_username" "text", "p_photo_url" "text", "p_hue_at_capture" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."submit_moment"("p_venue_id" "uuid", "p_username" "text", "p_photo_url" "text", "p_hue_at_capture" integer) IS 'Atomic gate-checked moment insert. Auth + Guest-block + once-per-venue. Computes and stores the user''s personal moment number (count + 1) so the engraved JPEG can show the correct ✦ #N.';



CREATE OR REPLACE FUNCTION "public"."touch_paint_prompts_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;


ALTER FUNCTION "public"."touch_paint_prompts_updated_at"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_config" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."app_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."besttime_collections" (
    "city" "text" NOT NULL,
    "collection_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "venue_count" integer DEFAULT 0,
    "last_synced_at" timestamp with time zone
);


ALTER TABLE "public"."besttime_collections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."besttime_live_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "forecasted_busyness" integer,
    "live_busyness" integer,
    "delta" integer,
    "venue_open" "text",
    "hour_start" integer,
    "raw_response" "jsonb"
);


ALTER TABLE "public"."besttime_live_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."besttime_refresh_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cycle_started_at" timestamp with time zone NOT NULL,
    "cycle_completed_at" timestamp with time zone,
    "city" "text" NOT NULL,
    "chunk" integer DEFAULT 0 NOT NULL,
    "venues_processed" integer DEFAULT 0,
    "snapshots_persisted" integer DEFAULT 0,
    "signals_emitted_total" integer DEFAULT 0,
    "errors_count" integer DEFAULT 0,
    "error_details" "jsonb",
    "triggered_by" "text"
);


ALTER TABLE "public"."besttime_refresh_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid" NOT NULL,
    "username" character varying(24) NOT NULL,
    "city" character varying(20) NOT NULL,
    "body" "text" NOT NULL,
    "night_of" "date" NOT NULL,
    CONSTRAINT "chat_messages_body_check" CHECK (("char_length"("body") <= 280))
);


ALTER TABLE "public"."chat_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checkins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "night_of" "date" NOT NULL,
    "city" character varying(20)
);


ALTER TABLE "public"."checkins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."headcount_estimates" (
    "venue_id" "uuid" NOT NULL,
    "estimate" integer DEFAULT 0 NOT NULL,
    "estimate_low" integer DEFAULT 0 NOT NULL,
    "estimate_high" integer DEFAULT 0 NOT NULL,
    "confidence" numeric DEFAULT 0 NOT NULL,
    "capacity_pct" numeric,
    "state_label" "text" DEFAULT 'quiet'::"text" NOT NULL,
    "trend" "text" DEFAULT 'flat'::"text" NOT NULL,
    "baseline_component" integer DEFAULT 0,
    "signal_component" integer DEFAULT 0,
    "override_active" boolean DEFAULT false,
    "override_expires_at" timestamp with time zone,
    "dominant_signal_source" "text",
    "active_signal_count" integer DEFAULT 0,
    "last_calculated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "confidence_pct" integer DEFAULT 0,
    "last_signal_at" timestamp with time zone,
    "source_breakdown" "jsonb",
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "delta_pct" numeric,
    "trend_rate" numeric,
    "expected_pct" numeric,
    CONSTRAINT "headcount_estimates_confidence_check" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric))),
    CONSTRAINT "headcount_estimates_trend_check" CHECK (("trend" = ANY (ARRAY['rising'::"text", 'falling'::"text", 'flat'::"text", 'surging'::"text"])))
);


ALTER TABLE "public"."headcount_estimates" OWNER TO "postgres";


COMMENT ON COLUMN "public"."headcount_estimates"."delta_pct" IS 'Signed % performance vs expected curve. live / expected - 1, expressed as percent. NULL when low confidence or no curve. THE hero number for the market UX.';



COMMENT ON COLUMN "public"."headcount_estimates"."trend_rate" IS 'Rate of change in estimate units per minute. Positive = rising, negative = falling. Magnitude conveys speed.';



COMMENT ON COLUMN "public"."headcount_estimates"."expected_pct" IS 'What the baseline curve says this venue should be at right now. The reference price.';



CREATE TABLE IF NOT EXISTS "public"."venues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "name" character varying(100) NOT NULL,
    "slug" character varying(100) NOT NULL,
    "city" character varying(20) NOT NULL,
    "category" character varying(20) DEFAULT 'bar'::character varying,
    "address" "text",
    "lat" numeric(10,6) NOT NULL,
    "lng" numeric(10,6) NOT NULL,
    "image_url" "text",
    "deals" "text",
    "hours" "text",
    "instagram" "text",
    "vibe_tagline" "text",
    "phone" character varying(20),
    "website" character varying(200),
    "description" "text",
    "rating" numeric(2,1),
    "review_count" integer,
    "capacity" integer,
    "is_clicker_live" boolean DEFAULT false,
    "staff_code" character varying(6),
    "has_live_cam" boolean DEFAULT false,
    "live_cam_url" "text",
    "cam_coming_soon" boolean DEFAULT true,
    "is_active" boolean DEFAULT true,
    "sort_order" integer DEFAULT 0,
    "tonight_special" "text",
    "special_updated_at" timestamp with time zone,
    "cover_charge" "text",
    "featured" boolean DEFAULT false,
    "featured_label" "text",
    "loyalty_active" boolean DEFAULT false,
    "nfc_tag_id" "text",
    "nfc_required" boolean DEFAULT false,
    "nfc_password" "text",
    "nfc_radius_meters" integer DEFAULT 150,
    "cover_price" "text",
    "special" "text",
    "besttime_venue_id" "text",
    "live_busyness_pct" integer,
    "live_busyness_vs_forecast" integer,
    "live_busyness_updated_at" timestamp with time zone,
    "besttime_collection_id" "text",
    "effective_capacity" integer,
    "fire_capacity" integer,
    "cover_policy" "text",
    "venue_notes" "text",
    "vibe_hue_baseline" "jsonb",
    "vibe_disagreement" boolean DEFAULT false NOT NULL,
    "canonical_hue_id" integer DEFAULT 7 NOT NULL,
    "is_hub" boolean DEFAULT false,
    "hub_subtitle" "text",
    "tenant_of" "uuid",
    "hours_json" "jsonb"
);


ALTER TABLE "public"."venues" OWNER TO "postgres";


COMMENT ON COLUMN "public"."venues"."vibe_tagline" IS 'Legacy marketing copy / tagline. Distinct from vibe_hue_baseline.';



COMMENT ON COLUMN "public"."venues"."nfc_password" IS 'Plain text password written to NFC NDEF text record. Server compares this to the password the client reads from the tag during NFC check-in.';



COMMENT ON COLUMN "public"."venues"."besttime_venue_id" IS 'BestTime.app venue_id — set after first forecast pull. Used for cheap query refreshes.';



COMMENT ON COLUMN "public"."venues"."live_busyness_pct" IS 'Most recent BestTime live busyness 0-100. Refreshed by the live cron.';



COMMENT ON COLUMN "public"."venues"."live_busyness_vs_forecast" IS 'Signed delta: live - forecasted. Positive = surge, negative = dud.';



COMMENT ON COLUMN "public"."venues"."besttime_collection_id" IS 'BestTime collection this venue is registered with — set by setup-besttime-collections.cjs.';



COMMENT ON COLUMN "public"."venues"."vibe_hue_baseline" IS 'Founder-authored hue per time band. Keys: wk_early, wk_peak, wknd_early, wknd_peak. Values: 1-14.';



COMMENT ON COLUMN "public"."venues"."vibe_disagreement" IS 'True if founders did not agree on baseline. Triggers faster decay so user paints override sooner.';



CREATE OR REPLACE VIEW "public"."city_aggregates" AS
 WITH "city_centers" AS (
         SELECT 'knoxville'::"text" AS "city",
            35.9606 AS "center_lat",
            (- 83.9207) AS "center_lng"
        UNION ALL
         SELECT 'tampa'::"text",
            27.9506,
            '-82.4572'::numeric
        UNION ALL
         SELECT 'st_petersburg'::"text",
            27.7676,
            '-82.6404'::numeric
        ), "joined" AS (
         SELECT "v"."city",
            "v"."id" AS "venue_id",
            "h"."estimate",
            "h"."confidence_pct",
            "h"."state_label",
            (("h"."state_label" IS NOT NULL) AND ("h"."state_label" <> 'Unknown'::"text") AND (COALESCE("h"."confidence_pct", 0) >= 20)) AS "is_active"
           FROM ("public"."venues" "v"
             LEFT JOIN "public"."headcount_estimates" "h" ON (("h"."venue_id" = "v"."id")))
          WHERE ((COALESCE("v"."is_active", true) = true) AND (("v"."city")::"text" = ANY ((ARRAY['knoxville'::character varying, 'tampa'::character varying, 'st_petersburg'::character varying])::"text"[])))
        ), "rolled" AS (
         SELECT "j"."city",
            "count"(*) AS "total_venues",
            "count"(*) FILTER (WHERE "j"."is_active") AS "active_count",
            (COALESCE("sum"("j"."estimate") FILTER (WHERE "j"."is_active"), (0)::bigint))::integer AS "people_out",
            "count"(*) FILTER (WHERE ("j"."is_active" AND ("j"."state_label" = 'Surging'::"text"))) AS "surging_count",
            "count"(*) FILTER (WHERE ("j"."is_active" AND ("j"."state_label" = 'Packed'::"text"))) AS "packed_count",
            "count"(*) FILTER (WHERE ("j"."is_active" AND ("j"."state_label" = 'Busy'::"text"))) AS "busy_count",
            "count"(*) FILTER (WHERE ("j"."is_active" AND ("j"."state_label" = 'Lively'::"text"))) AS "lively_count",
            "count"(*) FILTER (WHERE ("j"."is_active" AND ("j"."state_label" = 'Quiet'::"text"))) AS "quiet_count",
            COALESCE(("round"("avg"("j"."confidence_pct") FILTER (WHERE "j"."is_active")))::integer, 0) AS "avg_confidence"
           FROM "joined" "j"
          GROUP BY "j"."city"
        )
 SELECT "c"."city",
    COALESCE("r"."total_venues", (0)::bigint) AS "total_venues",
    COALESCE("r"."active_count", (0)::bigint) AS "active_count",
    COALESCE("r"."people_out", 0) AS "people_out",
        CASE
            WHEN (COALESCE("r"."surging_count", (0)::bigint) >= 3) THEN 'Surging'::"text"
            WHEN ((COALESCE("r"."packed_count", (0)::bigint) + COALESCE("r"."surging_count", (0)::bigint)) >= 3) THEN 'Packed'::"text"
            WHEN (((COALESCE("r"."busy_count", (0)::bigint) + COALESCE("r"."packed_count", (0)::bigint)) + COALESCE("r"."surging_count", (0)::bigint)) >= 4) THEN 'Busy'::"text"
            WHEN ((((COALESCE("r"."lively_count", (0)::bigint) + COALESCE("r"."busy_count", (0)::bigint)) + COALESCE("r"."packed_count", (0)::bigint)) + COALESCE("r"."surging_count", (0)::bigint)) >= 4) THEN 'Lively'::"text"
            ELSE 'Quiet'::"text"
        END AS "dominant_state",
    "c"."center_lat",
    "c"."center_lng",
    COALESCE("r"."surging_count", (0)::bigint) AS "surging_count",
    COALESCE("r"."packed_count", (0)::bigint) AS "packed_count",
    COALESCE("r"."busy_count", (0)::bigint) AS "busy_count",
    COALESCE("r"."lively_count", (0)::bigint) AS "lively_count",
    COALESCE("r"."quiet_count", (0)::bigint) AS "quiet_count",
    COALESCE("r"."avg_confidence", 0) AS "avg_confidence"
   FROM ("city_centers" "c"
     LEFT JOIN "rolled" "r" ON ((("r"."city")::"text" = "c"."city")));


ALTER VIEW "public"."city_aggregates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "auth_id" "uuid",
    "email" "text",
    "username" character varying(24),
    "display_name" character varying(50),
    "class_year" integer,
    "city" character varying(20) DEFAULT 'knoxville'::character varying,
    "avatar_url" "text",
    "total_checkins" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "bio" "text",
    "tagline" "text",
    "avatar_color" "text" DEFAULT 'orange'::"text",
    "profile_share_token" "text",
    "show_recaps_publicly" boolean DEFAULT true,
    "show_visits_publicly" boolean DEFAULT true,
    "leaderboard_excluded" boolean DEFAULT false NOT NULL,
    CONSTRAINT "profiles_avatar_color_valid" CHECK (("avatar_color" = ANY (ARRAY['orange'::"text", 'cyan'::"text", 'purple'::"text", 'green'::"text", 'pink'::"text", 'gold'::"text", 'sienna'::"text", 'wine'::"text"]))),
    CONSTRAINT "profiles_bio_length" CHECK ((("bio" IS NULL) OR ("char_length"("bio") <= 160))),
    CONSTRAINT "profiles_tagline_length" CHECK ((("tagline" IS NULL) OR ("char_length"("tagline") <= 50)))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_visits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "night_of" "date" NOT NULL,
    "first_seen_at" timestamp with time zone NOT NULL,
    "last_seen_at" timestamp with time zone NOT NULL,
    "duration_min" integer,
    "source" "text" NOT NULL,
    "confidence" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_visits_confidence_check" CHECK ((("confidence" >= 0) AND ("confidence" <= 100))),
    CONSTRAINT "user_visits_source_check" CHECK (("source" = ANY (ARRAY['passive'::"text", 'nfc'::"text", 'cover'::"text", 'plan_stop'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."user_visits" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_visits" IS 'Confirmed visits. Source of truth for "Venues Discovered" and "Nights Out". Populated by passive geolocation + NFC + covers + completed plans. Distinct from loyalty_visits which tracks NFC-only for rewards.';



CREATE OR REPLACE VIEW "public"."city_leaderboard" AS
 WITH "city_visits" AS (
         SELECT "uv"."user_id" AS "profile_id",
            "ven"."city",
            "count"(DISTINCT "uv"."venue_id") AS "venues_in_city",
            "count"(DISTINCT "uv"."night_of") AS "nights_in_city",
            "count"(*) AS "visits_in_city"
           FROM ("public"."user_visits" "uv"
             JOIN "public"."venues" "ven" ON (("ven"."id" = "uv"."venue_id")))
          GROUP BY "uv"."user_id", "ven"."city"
        ), "city_recaps" AS (
         SELECT "vr"."user_id" AS "profile_id",
            "ven"."city",
            "count"(*) AS "recaps_in_city"
           FROM ("public"."venue_recaps" "vr"
             JOIN "public"."venues" "ven" ON (("ven"."id" = "vr"."venue_id")))
          WHERE ("vr"."user_id" IS NOT NULL)
          GROUP BY "vr"."user_id", "ven"."city"
        ), "combined" AS (
         SELECT COALESCE("cv"."profile_id", "cr"."profile_id") AS "profile_id",
            COALESCE("cv"."city", "cr"."city") AS "city",
            COALESCE("cv"."venues_in_city", (0)::bigint) AS "venues_in_city",
            COALESCE("cv"."nights_in_city", (0)::bigint) AS "nights_in_city",
            COALESCE("cv"."visits_in_city", (0)::bigint) AS "visits_in_city",
            COALESCE("cr"."recaps_in_city", (0)::bigint) AS "recaps_in_city"
           FROM ("city_visits" "cv"
             FULL JOIN "city_recaps" "cr" ON ((("cv"."profile_id" = "cr"."profile_id") AND (("cv"."city")::"text" = ("cr"."city")::"text"))))
        ), "scored" AS (
         SELECT "c"."profile_id",
            "c"."city",
            "c"."venues_in_city",
            "c"."nights_in_city",
            "c"."visits_in_city",
            "c"."recaps_in_city",
            ((((("c"."venues_in_city" * 100) + ("c"."recaps_in_city" * 60)) + ("c"."nights_in_city" * 50)) + ("c"."visits_in_city" * 10)))::integer AS "city_score"
           FROM "combined" "c"
        )
 SELECT "sc"."profile_id",
    "sc"."city",
    "p"."username",
    "p"."display_name",
    "p"."avatar_color",
    "p"."avatar_url",
    "sc"."venues_in_city",
    "sc"."nights_in_city",
    "sc"."visits_in_city",
    "sc"."recaps_in_city",
    "sc"."city_score",
    "rank"() OVER (PARTITION BY "sc"."city" ORDER BY "sc"."city_score" DESC) AS "city_rank",
    "count"(*) OVER (PARTITION BY "sc"."city") AS "city_total_ranked"
   FROM ("scored" "sc"
     JOIN "public"."profiles" "p" ON (("p"."id" = "sc"."profile_id")))
  WHERE ((COALESCE("p"."leaderboard_excluded", false) = false) AND (COALESCE("p"."is_active", true) = true) AND ("sc"."city_score" > 0));


ALTER VIEW "public"."city_leaderboard" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."city_pulse" AS
 WITH "confident_estimates" AS (
         SELECT "v"."city",
            "he"."delta_pct",
            "he"."confidence_pct",
            "he"."state_label",
            "he"."estimate"
           FROM ("public"."headcount_estimates" "he"
             JOIN "public"."venues" "v" ON (("v"."id" = "he"."venue_id")))
          WHERE (("v"."is_active" = true) AND (("v"."city")::"text" = ANY ((ARRAY['knoxville'::character varying, 'tampa'::character varying, 'st_petersburg'::character varying])::"text"[])) AND (("v"."category" IS NULL) OR (("v"."category")::"text" <> ALL ((ARRAY['greek'::character varying, 'fraternity'::character varying])::"text"[]))) AND ("he"."confidence_pct" >= 35) AND ("he"."delta_pct" IS NOT NULL) AND ("he"."computed_at" >= ("now"() - '00:05:00'::interval)))
        )
 SELECT "city",
    "count"(*) AS "venues_with_signal",
    "round"("avg"("delta_pct"), 1) AS "avg_delta_pct",
    "round"("max"("delta_pct"), 1) AS "top_riser_delta",
    "round"("min"("delta_pct"), 1) AS "top_faller_delta",
    "count"(*) FILTER (WHERE ("state_label" = 'Surging'::"text")) AS "surging_count",
    "count"(*) FILTER (WHERE ("state_label" = ANY (ARRAY['Packed'::"text", 'Busy'::"text"]))) AS "busy_count",
    "count"(*) FILTER (WHERE ("state_label" = 'Quiet'::"text")) AS "quiet_count",
    "now"() AS "computed_at"
   FROM "confident_estimates"
  GROUP BY "city";


ALTER VIEW "public"."city_pulse" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clicker_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "venue_id" "uuid" NOT NULL,
    "staff_id" "uuid",
    "action" character varying(10) NOT NULL,
    "night_of" "date" NOT NULL,
    "count_after" integer NOT NULL
);


ALTER TABLE "public"."clicker_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cover_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "night_of" "date" NOT NULL,
    "base_price" integer NOT NULL,
    "cap_price" integer NOT NULL,
    "capacity" integer NOT NULL,
    "open_time" timestamp with time zone NOT NULL,
    "close_time" timestamp with time zone NOT NULL,
    "current_price" integer NOT NULL,
    "covers_sold" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "platform_fee_percent" numeric DEFAULT 0.08,
    "pricing_mode" "text" DEFAULT 'dynamic'::"text",
    "security_fee_percent" numeric DEFAULT 0,
    CONSTRAINT "cover_configs_cap_price_check" CHECK (("cap_price" >= "base_price")),
    CONSTRAINT "cover_configs_capacity_check" CHECK (("capacity" > 0)),
    CONSTRAINT "cover_configs_check1" CHECK (("close_time" > "open_time"))
);


ALTER TABLE "public"."cover_configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cover_price_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cover_config_id" "uuid" NOT NULL,
    "price" integer NOT NULL,
    "covers_sold_at_tick" integer NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."cover_price_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cover_purchases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cover_config_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "price_paid" integer NOT NULL,
    "platform_fee" integer NOT NULL,
    "venue_payout" integer NOT NULL,
    "stripe_payment_intent_id" "text" NOT NULL,
    "stripe_transfer_id" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "qr_code" "text" NOT NULL,
    "purchased_at" timestamp with time zone DEFAULT "now"(),
    "used_at" timestamp with time zone,
    CONSTRAINT "cover_purchases_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'refunded'::"text", 'used'::"text"])))
);


ALTER TABLE "public"."cover_purchases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."headcount_accuracy_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "bouncer_signal_id" "uuid",
    "bouncer_count" integer NOT NULL,
    "effective_capacity_at_truth" integer,
    "predicted_estimate" integer,
    "predicted_state" "text",
    "predicted_delta_pct" numeric,
    "predicted_confidence_pct" integer,
    "predicted_baseline_source" "text",
    "prediction_age_seconds" integer,
    "true_state" "text",
    "true_capacity_pct" numeric,
    "match_score" numeric,
    "match_kind" "text",
    "state_distance" integer,
    "signals_active_count" integer,
    "signals_breakdown" "jsonb",
    "notes" "text"
);


ALTER TABLE "public"."headcount_accuracy_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."headcount_accuracy_log" IS 'Predicted-vs-actual paired observations. Every bouncer signal triggers one row capturing what the engine predicted in the 10 min prior. Source of truth for engine accuracy metric.';



CREATE OR REPLACE VIEW "public"."engine_accuracy_by_baseline" AS
 SELECT "predicted_baseline_source",
    "count"(*) AS "sample_size",
    "round"(("avg"("match_score") * (100)::numeric), 1) AS "accuracy_pct",
    "count"(*) FILTER (WHERE ("match_kind" = 'exact'::"text")) AS "exact",
    "count"(*) FILTER (WHERE ("match_kind" = 'one_step'::"text")) AS "one_step",
    "count"(*) FILTER (WHERE ("match_kind" = 'miss'::"text")) AS "miss"
   FROM "public"."headcount_accuracy_log" "al"
  WHERE (("recorded_at" >= ("now"() - '30 days'::interval)) AND ("match_kind" <> 'unmeasurable'::"text") AND ("predicted_baseline_source" IS NOT NULL))
  GROUP BY "predicted_baseline_source"
  ORDER BY ("count"(*)) DESC;


ALTER VIEW "public"."engine_accuracy_by_baseline" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."engine_accuracy_by_city" AS
 SELECT "v"."city",
    "count"(*) FILTER (WHERE ("al"."match_kind" <> 'unmeasurable'::"text")) AS "sample_size",
    "round"(("avg"("al"."match_score") FILTER (WHERE ("al"."match_kind" <> 'unmeasurable'::"text")) * (100)::numeric), 1) AS "accuracy_14d_pct",
    "count"(*) FILTER (WHERE ("al"."match_kind" = 'exact'::"text")) AS "exact",
    "count"(*) FILTER (WHERE ("al"."match_kind" = 'one_step'::"text")) AS "one_step",
    "count"(*) FILTER (WHERE ("al"."match_kind" = 'miss'::"text")) AS "miss",
    "count"(*) FILTER (WHERE ("al"."match_kind" = 'unmeasurable'::"text")) AS "unmeasurable"
   FROM ("public"."headcount_accuracy_log" "al"
     JOIN "public"."venues" "v" ON (("v"."id" = "al"."venue_id")))
  WHERE ("al"."recorded_at" >= ("now"() - '14 days'::interval))
  GROUP BY "v"."city"
  ORDER BY ("round"(("avg"("al"."match_score") FILTER (WHERE ("al"."match_kind" <> 'unmeasurable'::"text")) * (100)::numeric), 1)) DESC NULLS LAST;


ALTER VIEW "public"."engine_accuracy_by_city" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."engine_accuracy_by_venue" AS
 SELECT "v"."name",
    "v"."city",
    "count"(*) FILTER (WHERE ("al"."match_kind" <> 'unmeasurable'::"text")) AS "sample_size",
    "round"(("avg"("al"."match_score") FILTER (WHERE ("al"."match_kind" <> 'unmeasurable'::"text")) * (100)::numeric), 1) AS "accuracy_pct",
    "count"(*) FILTER (WHERE ("al"."match_kind" = 'exact'::"text")) AS "exact",
    "count"(*) FILTER (WHERE ("al"."match_kind" = 'one_step'::"text")) AS "one_step",
    "count"(*) FILTER (WHERE ("al"."match_kind" = 'miss'::"text")) AS "miss",
    "max"("al"."recorded_at") AS "last_truth_at"
   FROM ("public"."headcount_accuracy_log" "al"
     JOIN "public"."venues" "v" ON (("v"."id" = "al"."venue_id")))
  WHERE ("al"."recorded_at" >= ("now"() - '30 days'::interval))
  GROUP BY "v"."id", "v"."name", "v"."city"
 HAVING ("count"(*) FILTER (WHERE ("al"."match_kind" <> 'unmeasurable'::"text")) > 0)
  ORDER BY ("count"(*) FILTER (WHERE ("al"."match_kind" <> 'unmeasurable'::"text"))) DESC, ("round"(("avg"("al"."match_score") FILTER (WHERE ("al"."match_kind" <> 'unmeasurable'::"text")) * (100)::numeric), 1)) DESC;


ALTER VIEW "public"."engine_accuracy_by_venue" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."engine_accuracy_overall" AS
 WITH "measurable" AS (
         SELECT "al"."match_score",
            "al"."match_kind",
            "al"."state_distance",
            "al"."recorded_at",
            "al"."predicted_baseline_source",
            "v"."city"
           FROM ("public"."headcount_accuracy_log" "al"
             JOIN "public"."venues" "v" ON (("v"."id" = "al"."venue_id")))
          WHERE ("al"."match_kind" <> 'unmeasurable'::"text")
        )
 SELECT '7_days'::"text" AS "window",
    "count"(*) AS "sample_size",
    "round"(("avg"("measurable"."match_score") * (100)::numeric), 1) AS "accuracy_pct",
    "count"(*) FILTER (WHERE ("measurable"."match_kind" = 'exact'::"text")) AS "exact_matches",
    "count"(*) FILTER (WHERE ("measurable"."match_kind" = 'one_step'::"text")) AS "one_step_matches",
    "count"(*) FILTER (WHERE ("measurable"."match_kind" = 'miss'::"text")) AS "misses",
    "count"(*) FILTER (WHERE ("measurable"."match_kind" = 'unknown_prediction'::"text")) AS "unknown_predictions"
   FROM "measurable"
  WHERE ("measurable"."recorded_at" >= ("now"() - '7 days'::interval))
UNION ALL
 SELECT '14_days'::"text" AS "window",
    "count"(*) AS "sample_size",
    "round"(("avg"("measurable"."match_score") * (100)::numeric), 1) AS "accuracy_pct",
    "count"(*) FILTER (WHERE ("measurable"."match_kind" = 'exact'::"text")) AS "exact_matches",
    "count"(*) FILTER (WHERE ("measurable"."match_kind" = 'one_step'::"text")) AS "one_step_matches",
    "count"(*) FILTER (WHERE ("measurable"."match_kind" = 'miss'::"text")) AS "misses",
    "count"(*) FILTER (WHERE ("measurable"."match_kind" = 'unknown_prediction'::"text")) AS "unknown_predictions"
   FROM "measurable"
  WHERE ("measurable"."recorded_at" >= ("now"() - '14 days'::interval))
UNION ALL
 SELECT '30_days'::"text" AS "window",
    "count"(*) AS "sample_size",
    "round"(("avg"("measurable"."match_score") * (100)::numeric), 1) AS "accuracy_pct",
    "count"(*) FILTER (WHERE ("measurable"."match_kind" = 'exact'::"text")) AS "exact_matches",
    "count"(*) FILTER (WHERE ("measurable"."match_kind" = 'one_step'::"text")) AS "one_step_matches",
    "count"(*) FILTER (WHERE ("measurable"."match_kind" = 'miss'::"text")) AS "misses",
    "count"(*) FILTER (WHERE ("measurable"."match_kind" = 'unknown_prediction'::"text")) AS "unknown_predictions"
   FROM "measurable"
  WHERE ("measurable"."recorded_at" >= ("now"() - '30 days'::interval));


ALTER VIEW "public"."engine_accuracy_overall" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_rsvps" (
    "user_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."event_rsvps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid",
    "city" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "event_type" "text" NOT NULL,
    "host_name" "text" NOT NULL,
    "start_time" timestamp with time zone NOT NULL,
    "latitude" double precision NOT NULL,
    "longitude" double precision NOT NULL,
    "image_url" "text",
    "created_by" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_active" boolean DEFAULT true,
    "expires_at" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone,
    "name" "text",
    "has_tickets" boolean DEFAULT false,
    "ticket_price" integer,
    "total_tickets" integer,
    "tickets_sold" integer DEFAULT 0,
    "sale_ends_at" timestamp with time zone,
    "sale_starts_at" timestamp with time zone,
    "ticket_url" "text",
    "featured_partner" "text",
    "recurring_pattern" "text",
    "vibe_tags" "text"[] DEFAULT '{}'::"text"[],
    "featured_until" timestamp with time zone,
    "external_venue_name" "text",
    "hero_image_url" "text",
    "going_count" integer DEFAULT 0,
    "price_tier" "text",
    "curated" boolean DEFAULT false,
    "marquee" boolean DEFAULT false,
    CONSTRAINT "events_event_type_check" CHECK (("event_type" = ANY (ARRAY['party'::"text", 'brand'::"text", 'greek'::"text", 'launch'::"text", 'special'::"text", 'concert'::"text", 'cruise'::"text", 'fitness'::"text", 'tasting'::"text", 'community'::"text"]))),
    CONSTRAINT "events_price_tier_check" CHECK ((("price_tier" = ANY (ARRAY['free'::"text", 'low'::"text", 'mid'::"text", 'premium'::"text"])) OR ("price_tier" IS NULL))),
    CONSTRAINT "expires_after_start" CHECK (("expires_at" > "start_time"))
);


ALTER TABLE "public"."events" OWNER TO "postgres";


COMMENT ON COLUMN "public"."events"."ticket_url" IS 'External ticket purchase URL (e.g., LineLeap, Eventbrite). When set, EventCard renders a "Buy Tickets" button that opens this URL.';



CREATE TABLE IF NOT EXISTS "public"."globe_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid",
    "total_people_out" integer NOT NULL,
    "city_count" integer NOT NULL,
    "cities_snapshot" "jsonb" NOT NULL,
    "caption" "text",
    "shared_to" "text"
);


ALTER TABLE "public"."globe_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."headcount_estimates_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "estimate" integer DEFAULT 0 NOT NULL,
    "estimate_low" integer DEFAULT 0 NOT NULL,
    "estimate_high" integer DEFAULT 0 NOT NULL,
    "confidence" numeric DEFAULT 0 NOT NULL,
    "capacity_pct" numeric,
    "state_label" "text" DEFAULT 'quiet'::"text" NOT NULL,
    "trend" "text" DEFAULT 'flat'::"text" NOT NULL,
    "baseline_component" integer DEFAULT 0,
    "signal_component" integer DEFAULT 0,
    "override_active" boolean DEFAULT false,
    "override_expires_at" timestamp with time zone,
    "dominant_signal_source" "text",
    "active_signal_count" integer DEFAULT 0,
    "last_calculated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "confidence_pct" integer DEFAULT 0,
    "last_signal_at" timestamp with time zone,
    "source_breakdown" "jsonb",
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "delta_pct" numeric,
    "trend_rate" numeric,
    "expected_pct" numeric,
    CONSTRAINT "headcount_estimates_confidence_check" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric))),
    CONSTRAINT "headcount_estimates_trend_check" CHECK (("trend" = ANY (ARRAY['rising'::"text", 'falling'::"text", 'flat'::"text", 'surging'::"text"])))
);


ALTER TABLE "public"."headcount_estimates_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."headcount_signals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "signal_type" "text" NOT NULL,
    "signal_value" numeric DEFAULT 1.0,
    "confidence" numeric DEFAULT 1.0 NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "source_table" "text",
    "source_row_id" "uuid",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "headcount_signals_confidence_check" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric)))
);


ALTER TABLE "public"."headcount_signals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."headcounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "venue_id" "uuid" NOT NULL,
    "city" character varying(20) NOT NULL,
    "night_of" "date" NOT NULL,
    "current_count" integer DEFAULT 0,
    "peak_count" integer DEFAULT 0,
    "last_updated_by" "uuid",
    "is_live" boolean DEFAULT true,
    CONSTRAINT "headcounts_current_count_check" CHECK (("current_count" >= 0))
);


ALTER TABLE "public"."headcounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vibe_hue_lookup" (
    "hue_id" integer NOT NULL,
    "hue_name" "text" NOT NULL,
    "hsl_degrees" integer NOT NULL,
    "default_saturation" integer NOT NULL,
    "display_hex" "text" NOT NULL,
    "internal_anchor" "text",
    "spectrum_order" integer NOT NULL,
    CONSTRAINT "vibe_hue_lookup_default_saturation_check" CHECK ((("default_saturation" >= 0) AND ("default_saturation" <= 100))),
    CONSTRAINT "vibe_hue_lookup_hsl_degrees_check" CHECK ((("hsl_degrees" >= 0) AND ("hsl_degrees" <= 360))),
    CONSTRAINT "vibe_hue_lookup_hue_id_check" CHECK ((("hue_id" >= 1) AND ("hue_id" <= 14)))
);


ALTER TABLE "public"."vibe_hue_lookup" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."heat_points" AS
 SELECT "v"."id" AS "venue_id",
    "v"."name",
    "v"."city",
    "v"."lat",
    "v"."lng",
    "v"."capacity" AS "venue_capacity",
    COALESCE("public"."get_venue_current_hue"("v"."id"), 14) AS "hue_id",
    COALESCE("vhl"."hsl_degrees", 240) AS "hue_degrees",
    COALESCE("vhl"."default_saturation", 18) AS "hue_default_saturation",
    COALESCE("he"."state_label", 'Unknown'::"text") AS "state_label",
    COALESCE("he"."capacity_pct", (0)::numeric) AS "capacity_pct",
    COALESCE("he"."confidence_pct", 0) AS "confidence_pct",
    COALESCE("he"."estimate", 0) AS "estimate",
    LEAST(1.0, ((0.55 + (COALESCE("he"."capacity_pct", (0)::numeric) * 0.3)) +
        CASE
            WHEN ("he"."state_label" = 'Surging'::"text") THEN 0.20
            WHEN ("he"."state_label" = 'Packed'::"text") THEN 0.15
            WHEN ("he"."state_label" = 'Busy'::"text") THEN 0.10
            WHEN ("he"."state_label" = 'Lively'::"text") THEN 0.05
            ELSE (0)::numeric
        END)) AS "heat_weight",
        CASE
            WHEN (COALESCE("he"."confidence_pct", 0) < 15) THEN (0)::numeric
            ELSE LEAST(1.0, ((COALESCE("he"."capacity_pct", (0)::numeric) * 0.6) +
            CASE
                WHEN ("he"."state_label" = 'Surging'::"text") THEN 0.40
                WHEN ("he"."state_label" = 'Packed'::"text") THEN 0.30
                WHEN ("he"."state_label" = 'Busy'::"text") THEN 0.20
                WHEN ("he"."state_label" = 'Lively'::"text") THEN 0.10
                ELSE (0)::numeric
            END))
        END AS "heat_weight_signal",
    "he"."last_calculated_at",
    "v"."is_active"
   FROM (("public"."venues" "v"
     LEFT JOIN "public"."headcount_estimates" "he" ON (("he"."venue_id" = "v"."id")))
     LEFT JOIN "public"."vibe_hue_lookup" "vhl" ON (("vhl"."hue_id" = COALESCE("public"."get_venue_current_hue"("v"."id"), 14))))
  WHERE (("v"."is_active" = true) AND ("v"."lat" IS NOT NULL) AND ("v"."lng" IS NOT NULL) AND (("v"."city")::"text" = ANY ((ARRAY['knoxville'::character varying, 'tampa'::character varying, 'st_petersburg'::character varying])::"text"[])));


ALTER VIEW "public"."heat_points" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."live_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "city" "text" NOT NULL,
    "fired_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:06:00'::interval) NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "claimed_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "live_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['surge_first'::"text", 'surge_rapid_rise'::"text", 'social_pulse'::"text"])))
);


ALTER TABLE "public"."live_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_redemptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "redeemed_at" timestamp with time zone DEFAULT "now"(),
    "verified_by_staff" boolean DEFAULT false
);


ALTER TABLE "public"."loyalty_redemptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_visits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "code_entered" character varying(4),
    "verified_at" timestamp with time zone DEFAULT "now"(),
    "night_of" "date" NOT NULL,
    "device_id" "text",
    "source" "text" DEFAULT 'gps'::"text"
);


ALTER TABLE "public"."loyalty_visits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nfc_tags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tag_uid" "text" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "position_label" "text",
    "master_key" "text",
    "last_counter" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "installed_at" timestamp with time zone,
    "tag_password" "text"
);


ALTER TABLE "public"."nfc_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nfc_taps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tag_id" "uuid",
    "user_id" "uuid",
    "venue_id" "uuid",
    "counter" integer NOT NULL,
    "cmac" "text",
    "verified" boolean DEFAULT false,
    "tapped_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."nfc_taps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."night_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "conversation_id" "uuid",
    "city" "text" NOT NULL,
    "title" "text" NOT NULL,
    "summary" "text",
    "stops" "jsonb" NOT NULL,
    "total_estimated_cost" integer,
    "total_duration_min" integer,
    "start_time" "text",
    "end_time" "text",
    "group_size" integer,
    "vibe_tags" "jsonb",
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "activated_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "share_token" "text",
    "current_stop_index" integer DEFAULT 0,
    "rating_status" "text" DEFAULT 'unrated'::"text",
    CONSTRAINT "night_plans_rating_status_check" CHECK (("rating_status" = ANY (ARRAY['unrated'::"text", 'pending_morning'::"text", 'rated'::"text", 'skipped'::"text"]))),
    CONSTRAINT "night_plans_status_check" CHECK (("status" = ANY (ARRAY['planned'::"text", 'active'::"text", 'completed'::"text", 'abandoned'::"text"])))
);


ALTER TABLE "public"."night_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."night_ratings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "overall_rating" "text" NOT NULL,
    "mood_tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "would_repeat" boolean,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "night_ratings_overall_rating_check" CHECK (("overall_rating" = ANY (ARRAY['best_in_weeks'::"text", 'great'::"text", 'good'::"text", 'meh'::"text", 'bad'::"text"])))
);


ALTER TABLE "public"."night_ratings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nightly_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "code" character varying(4) NOT NULL,
    "night_of" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."nightly_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_venues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL
);


ALTER TABLE "public"."organization_venues" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."paint_prompts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "user_visit_id" "uuid",
    "visit_first_seen_at" timestamp with time zone NOT NULL,
    "visit_last_seen_at" timestamp with time zone NOT NULL,
    "visit_duration_min" integer NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "queued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "pushed_at" timestamp with time zone,
    "opened_at" timestamp with time zone,
    "painted_at" timestamp with time zone,
    "dismissed_at" timestamp with time zone,
    "expired_at" timestamp with time zone,
    "fire_not_before" timestamp with time zone NOT NULL,
    "vibe_rating_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "paint_prompts_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'pushed'::"text", 'opened'::"text", 'painted'::"text", 'dismissed'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."paint_prompts" OWNER TO "postgres";


COMMENT ON TABLE "public"."paint_prompts" IS 'Phase D rate-on-exit: lifecycle tracking for paint prompts. Service-role writes only.';



CREATE TABLE IF NOT EXISTS "public"."presence_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "distance_m" integer NOT NULL,
    "accuracy_m" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "presence_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['enter'::"text", 'still_present'::"text", 'exit'::"text"])))
);


ALTER TABLE "public"."presence_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_share_views" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "viewer_user_id" "uuid",
    "viewer_ip_hash" "text",
    "user_agent" "text",
    "referrer" "text",
    "viewed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profile_share_views" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."user_account_stats" AS
 SELECT "id" AS "profile_id",
    "auth_id",
    "username",
    (COALESCE(( SELECT "count"(DISTINCT "uv"."night_of") AS "count"
           FROM "public"."user_visits" "uv"
          WHERE ("uv"."user_id" = "p"."id")), (0)::bigint))::integer AS "nights_out",
    (COALESCE(( SELECT "count"(DISTINCT "uv"."venue_id") AS "count"
           FROM "public"."user_visits" "uv"
          WHERE ("uv"."user_id" = "p"."id")), (0)::bigint))::integer AS "venues_discovered",
    (COALESCE(( SELECT "count"(*) AS "count"
           FROM "public"."venue_recaps"
          WHERE (("venue_recaps"."username")::"text" = ("p"."username")::"text")), (0)::bigint))::integer AS "total_recaps",
    0 AS "taste_accuracy_pct",
    (COALESCE(( SELECT "count"(*) AS "count"
           FROM "public"."night_plans"
          WHERE ("night_plans"."user_id" = "p"."id")), (0)::bigint))::integer AS "total_plans",
    (COALESCE(( SELECT "count"(*) AS "count"
           FROM "public"."night_plans"
          WHERE (("night_plans"."user_id" = "p"."id") AND ("night_plans"."status" = 'completed'::"text"))), (0)::bigint))::integer AS "plans_completed",
    (COALESCE(( SELECT "count"(*) AS "count"
           FROM "public"."loyalty_redemptions"
          WHERE ("loyalty_redemptions"."user_id" = "p"."auth_id")), (0)::bigint))::integer AS "total_rewards",
    (COALESCE(( SELECT "count"(DISTINCT "loyalty_visits"."venue_id") AS "count"
           FROM "public"."loyalty_visits"
          WHERE ("loyalty_visits"."user_id" = "p"."auth_id")), (0)::bigint))::integer AS "loyalty_bars_count"
   FROM "public"."profiles" "p";


ALTER VIEW "public"."user_account_stats" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."public_profile_view" AS
 SELECT "p"."profile_share_token",
    "p"."username",
    "p"."display_name",
    "p"."bio",
    "p"."tagline",
    "p"."avatar_color",
    "p"."city" AS "home_city",
    "p"."created_at" AS "member_since",
    COALESCE("uas"."nights_out", 0) AS "nights_out",
    COALESCE("uas"."venues_discovered", 0) AS "venues_discovered",
    COALESCE("uas"."total_recaps", 0) AS "total_recaps",
    COALESCE("uas"."taste_accuracy_pct", 0) AS "taste_accuracy_pct",
    COALESCE("uas"."plans_completed", 0) AS "plans_completed"
   FROM ("public"."profiles" "p"
     LEFT JOIN "public"."user_account_stats" "uas" ON (("uas"."profile_id" = "p"."id")))
  WHERE (("p"."show_recaps_publicly" = true) OR ("p"."show_visits_publicly" = true));


ALTER VIEW "public"."public_profile_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "platform" character varying(10) DEFAULT 'ios'::character varying,
    "city" character varying(50),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."push_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rank_snapshots" (
    "id" bigint NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "snapshot_date" "date" DEFAULT (("now"() AT TIME ZONE 'America/New_York'::"text"))::"date" NOT NULL,
    "global_rank" integer,
    "venuu_score" integer
);


ALTER TABLE "public"."rank_snapshots" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."rank_snapshots_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."rank_snapshots_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."rank_snapshots_id_seq" OWNED BY "public"."rank_snapshots"."id";



CREATE TABLE IF NOT EXISTS "public"."security_organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "org_code" "text" NOT NULL,
    "city" "text",
    "contact_name" "text",
    "contact_phone" "text",
    "contact_email" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_active" boolean DEFAULT true
);


ALTER TABLE "public"."security_organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."signal_weights" (
    "signal_type" "text" NOT NULL,
    "weight" numeric DEFAULT 1.0 NOT NULL,
    "ttl_seconds" integer DEFAULT 3600 NOT NULL,
    "description" "text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."signal_weights" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stop_ratings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "stop_index" integer NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "rating" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stop_ratings_rating_check" CHECK (("rating" = ANY (ARRAY['loved'::"text", 'fine'::"text", 'meh'::"text"])))
);


ALTER TABLE "public"."stop_ratings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_config" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."system_config" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."tonight_movers" AS
 SELECT "v"."id" AS "venue_id",
    "v"."name" AS "venue_name",
    "v"."slug" AS "venue_slug",
    "v"."city",
    "v"."lat",
    "v"."lng",
    "v"."image_url",
    "he"."delta_pct",
    "he"."estimate",
    "he"."state_label",
    "he"."confidence_pct",
    "he"."trend",
    "he"."trend_rate",
    "he"."computed_at",
        CASE
            WHEN ("he"."delta_pct" >= (30)::numeric) THEN 'top_riser'::"text"
            WHEN ("he"."delta_pct" >= (15)::numeric) THEN 'rising'::"text"
            WHEN ("he"."delta_pct" <= ('-30'::integer)::numeric) THEN 'top_faller'::"text"
            WHEN ("he"."delta_pct" <= ('-15'::integer)::numeric) THEN 'falling'::"text"
            ELSE 'flat'::"text"
        END AS "movement_tier",
    "rank"() OVER (PARTITION BY "v"."city" ORDER BY "he"."delta_pct" DESC NULLS LAST) AS "rank_in_city_desc",
    "rank"() OVER (PARTITION BY "v"."city" ORDER BY "he"."delta_pct") AS "rank_in_city_asc"
   FROM ("public"."headcount_estimates" "he"
     JOIN "public"."venues" "v" ON (("v"."id" = "he"."venue_id")))
  WHERE (("v"."is_active" = true) AND (("v"."city")::"text" = ANY ((ARRAY['knoxville'::character varying, 'tampa'::character varying, 'st_petersburg'::character varying])::"text"[])) AND (("v"."category" IS NULL) OR (("v"."category")::"text" <> ALL ((ARRAY['greek'::character varying, 'fraternity'::character varying])::"text"[]))) AND ("he"."confidence_pct" >= 35) AND ("he"."delta_pct" IS NOT NULL) AND ("he"."computed_at" >= ("now"() - '00:05:00'::interval)));


ALTER VIEW "public"."tonight_movers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_preferences" (
    "user_id" "uuid" NOT NULL,
    "age" integer,
    "music_taste" "text",
    "typical_budget" "text",
    "dress_style" "text",
    "group_size_typical" integer,
    "vibes_liked" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    "vibes_disliked" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    "home_city" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_preferences" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."user_venuu_rank" AS
 WITH "scored" AS (
         SELECT "s"."profile_id",
            "s"."auth_id",
            "s"."username",
            "p"."display_name",
            "p"."city" AS "home_city",
            "p"."avatar_color",
            "p"."avatar_url",
            "p"."profile_share_token",
            COALESCE("s"."venues_discovered", 0) AS "venues_discovered",
            COALESCE("s"."total_recaps", 0) AS "total_recaps",
            COALESCE("s"."nights_out", 0) AS "nights_out",
            COALESCE("s"."plans_completed", 0) AS "plans_completed",
            COALESCE("s"."loyalty_bars_count", 0) AS "loyalty_bars_count",
            (((((COALESCE("s"."venues_discovered", 0) * 100) + (COALESCE("s"."total_recaps", 0) * 60)) + (COALESCE("s"."nights_out", 0) * 50)) + (COALESCE("s"."plans_completed", 0) * 40)) + (COALESCE("s"."loyalty_bars_count", 0) * 20)) AS "venuu_score"
           FROM ("public"."user_account_stats" "s"
             JOIN "public"."profiles" "p" ON (("p"."id" = "s"."profile_id")))
          WHERE ((COALESCE("p"."leaderboard_excluded", false) = false) AND (COALESCE("p"."is_active", true) = true))
        )
 SELECT "profile_id",
    "auth_id",
    "username",
    "display_name",
    "home_city",
    "avatar_color",
    "avatar_url",
    "profile_share_token",
    "venues_discovered",
    "total_recaps",
    "nights_out",
    "plans_completed",
    "loyalty_bars_count",
    "venuu_score",
    "rank"() OVER (ORDER BY "venuu_score" DESC) AS "global_rank",
    "count"(*) OVER () AS "total_ranked",
    ("round"((((1)::double precision - "percent_rank"() OVER (ORDER BY "venuu_score" DESC)) * (100)::double precision)))::integer AS "top_percentile"
   FROM "scored";


ALTER VIEW "public"."user_venuu_rank" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."user_rank_movement" AS
 WITH "latest_prior" AS (
         SELECT DISTINCT ON ("rs"."profile_id") "rs"."profile_id",
            "rs"."global_rank" AS "prior_rank"
           FROM "public"."rank_snapshots" "rs"
          WHERE ("rs"."snapshot_date" < (("now"() AT TIME ZONE 'America/New_York'::"text"))::"date")
          ORDER BY "rs"."profile_id", "rs"."snapshot_date" DESC
        )
 SELECT "r"."profile_id",
    "r"."global_rank" AS "current_rank",
    "lp"."prior_rank",
        CASE
            WHEN ("lp"."prior_rank" IS NULL) THEN NULL::bigint
            ELSE ("lp"."prior_rank" - "r"."global_rank")
        END AS "delta"
   FROM ("public"."user_venuu_rank" "r"
     LEFT JOIN "latest_prior" "lp" ON (("lp"."profile_id" = "r"."profile_id")));


ALTER VIEW "public"."user_rank_movement" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venny_conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "city" "text" NOT NULL,
    "title" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."venny_conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venny_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "content" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb",
    CONSTRAINT "venny_messages_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text", 'tool'::"text"])))
);


ALTER TABLE "public"."venny_messages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."venny_messages"."metadata" IS 'Per-message metadata. Currently used by Phase 4.5 market-aware Venny: { used_live_data: bool, market_snapshot_at: timestamptz }. Never sent back to Anthropic; client-only.';



CREATE TABLE IF NOT EXISTS "public"."venue_baselines" (
    "venue_id" "uuid" NOT NULL,
    "popular_times_curve" "jsonb",
    "learned_curve" "jsonb",
    "last_google_pull_at" timestamp with time zone,
    "last_learned_update_at" timestamp with time zone,
    "data_quality" "text" DEFAULT 'cold'::"text",
    "notes" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "venue_baselines_data_quality_check" CHECK (("data_quality" = ANY (ARRAY['cold'::"text", 'priors_only'::"text", 'warm'::"text", 'mature'::"text"])))
);


ALTER TABLE "public"."venue_baselines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venue_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "venue_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "username" character varying(24) DEFAULT 'anonymous'::character varying NOT NULL,
    "body" "text" NOT NULL,
    "day_of" "date" NOT NULL,
    CONSTRAINT "venue_comments_body_check" CHECK (("char_length"("body") <= 200))
);


ALTER TABLE "public"."venue_comments" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."venue_leaderboard" AS
 WITH "visit_agg" AS (
         SELECT "user_visits"."user_id" AS "profile_id",
            "user_visits"."venue_id",
            "count"(*) AS "visit_count",
            "count"(DISTINCT "user_visits"."night_of") AS "distinct_nights",
            COALESCE("sum"("user_visits"."duration_min"), (0)::bigint) AS "total_minutes"
           FROM "public"."user_visits"
          GROUP BY "user_visits"."user_id", "user_visits"."venue_id"
        ), "recap_agg" AS (
         SELECT "venue_recaps"."user_id" AS "profile_id",
            "venue_recaps"."venue_id",
            "count"(*) AS "recap_count"
           FROM "public"."venue_recaps"
          WHERE ("venue_recaps"."user_id" IS NOT NULL)
          GROUP BY "venue_recaps"."user_id", "venue_recaps"."venue_id"
        ), "combined" AS (
         SELECT COALESCE("v"."profile_id", "r"."profile_id") AS "profile_id",
            COALESCE("v"."venue_id", "r"."venue_id") AS "venue_id",
            COALESCE("v"."visit_count", (0)::bigint) AS "visit_count",
            COALESCE("v"."distinct_nights", (0)::bigint) AS "distinct_nights",
            COALESCE("v"."total_minutes", (0)::bigint) AS "total_minutes",
            COALESCE("r"."recap_count", (0)::bigint) AS "recap_count"
           FROM ("visit_agg" "v"
             FULL JOIN "recap_agg" "r" ON ((("v"."profile_id" = "r"."profile_id") AND ("v"."venue_id" = "r"."venue_id"))))
        ), "scored" AS (
         SELECT "c"."profile_id",
            "c"."venue_id",
            "c"."visit_count",
            "c"."distinct_nights",
            "c"."total_minutes",
            "c"."recap_count",
            (((((("c"."visit_count" * 10) + ("c"."distinct_nights" * 15)) + ("c"."recap_count" * 30)))::numeric + ((LEAST("c"."total_minutes", (600)::bigint))::numeric * 0.3)))::integer AS "venue_score"
           FROM "combined" "c"
        )
 SELECT "sc"."profile_id",
    "sc"."venue_id",
    "ven"."name" AS "venue_name",
    "ven"."slug" AS "venue_slug",
    "ven"."city",
    "p"."username",
    "p"."display_name",
    "p"."avatar_color",
    "p"."avatar_url",
    "sc"."visit_count",
    "sc"."distinct_nights",
    "sc"."total_minutes",
    "sc"."recap_count",
    "sc"."venue_score",
    "rank"() OVER (PARTITION BY "sc"."venue_id" ORDER BY "sc"."venue_score" DESC) AS "venue_rank"
   FROM (("scored" "sc"
     JOIN "public"."profiles" "p" ON (("p"."id" = "sc"."profile_id")))
     JOIN "public"."venues" "ven" ON (("ven"."id" = "sc"."venue_id")))
  WHERE ((COALESCE("p"."leaderboard_excluded", false) = false) AND (COALESCE("p"."is_active", true) = true) AND ("sc"."venue_score" > 0));


ALTER VIEW "public"."venue_leaderboard" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venue_rewards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "reward_text" "text" NOT NULL,
    "visits_required" integer DEFAULT 5,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "reward_description" "text"
);


ALTER TABLE "public"."venue_rewards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venue_stripe_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "stripe_account_id" "text" NOT NULL,
    "is_verified" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."venue_stripe_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venue_updates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "venue_id" "uuid" NOT NULL,
    "venue_name" "text" NOT NULL,
    "message" "text" NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '04:00:00'::interval),
    CONSTRAINT "venue_updates_message_check" CHECK (("char_length"("message") <= 140))
);


ALTER TABLE "public"."venue_updates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vibe_ratings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "venue_id" "uuid" NOT NULL,
    "hue_id" integer NOT NULL,
    "time_band" "text" NOT NULL,
    "painted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "visit_id" "uuid",
    CONSTRAINT "vibe_ratings_time_band_check" CHECK (("time_band" = ANY (ARRAY['wk_early'::"text", 'wk_peak'::"text", 'wknd_early'::"text", 'wknd_peak'::"text"])))
);


ALTER TABLE "public"."vibe_ratings" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."vibe_canvas_points" AS
 SELECT "v"."id" AS "venue_id",
    "v"."name",
    "v"."city",
    "v"."lat",
    "v"."lng",
    COALESCE("public"."get_venue_current_hue"("v"."id"), 8) AS "hue_id",
    COALESCE("hl"."hsl_degrees", 30) AS "hue_degrees",
    COALESCE("hl"."default_saturation", 75) AS "saturation_pct",
    LEAST(1.0, ((0.70 + ((COALESCE("paint_counts"."cnt", (0)::bigint))::numeric * 0.015)) +
        CASE
            WHEN ("he"."state_label" = 'Surging'::"text") THEN 0.10
            WHEN ("he"."state_label" = 'Packed'::"text") THEN 0.07
            WHEN ("he"."state_label" = 'Busy'::"text") THEN 0.04
            ELSE (0)::numeric
        END)) AS "intensity",
    COALESCE("he"."state_label", 'Unknown'::"text") AS "state_label",
    COALESCE("he"."capacity_pct", (0)::numeric) AS "capacity_pct",
    COALESCE("paint_counts"."cnt", (0)::bigint) AS "paint_count",
    "now"() AS "computed_at"
   FROM ((("public"."venues" "v"
     LEFT JOIN "public"."vibe_hue_lookup" "hl" ON (("hl"."hue_id" = COALESCE("public"."get_venue_current_hue"("v"."id"), 8))))
     LEFT JOIN "public"."headcount_estimates" "he" ON (("he"."venue_id" = "v"."id")))
     LEFT JOIN ( SELECT "vibe_ratings"."venue_id",
            "count"(*) AS "cnt"
           FROM "public"."vibe_ratings"
          GROUP BY "vibe_ratings"."venue_id") "paint_counts" ON (("paint_counts"."venue_id" = "v"."id")))
  WHERE (("v"."is_active" = true) AND ("v"."lat" IS NOT NULL) AND ("v"."lng" IS NOT NULL));


ALTER VIEW "public"."vibe_canvas_points" OWNER TO "postgres";


ALTER TABLE ONLY "public"."rank_snapshots" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."rank_snapshots_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."app_config"
    ADD CONSTRAINT "app_config_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."besttime_collections"
    ADD CONSTRAINT "besttime_collections_pkey" PRIMARY KEY ("city");



ALTER TABLE ONLY "public"."besttime_live_snapshots"
    ADD CONSTRAINT "besttime_live_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."besttime_refresh_runs"
    ADD CONSTRAINT "besttime_refresh_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checkins"
    ADD CONSTRAINT "checkins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checkins"
    ADD CONSTRAINT "checkins_user_id_night_of_key" UNIQUE ("user_id", "night_of");



ALTER TABLE ONLY "public"."clicker_logs"
    ADD CONSTRAINT "clicker_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cover_configs"
    ADD CONSTRAINT "cover_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cover_configs"
    ADD CONSTRAINT "cover_configs_venue_id_night_of_key" UNIQUE ("venue_id", "night_of");



ALTER TABLE ONLY "public"."cover_price_history"
    ADD CONSTRAINT "cover_price_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cover_purchases"
    ADD CONSTRAINT "cover_purchases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cover_purchases"
    ADD CONSTRAINT "cover_purchases_user_id_cover_config_id_key" UNIQUE ("user_id", "cover_config_id");



ALTER TABLE ONLY "public"."event_rsvps"
    ADD CONSTRAINT "event_rsvps_pkey" PRIMARY KEY ("user_id", "event_id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."globe_snapshots"
    ADD CONSTRAINT "globe_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."headcount_accuracy_log"
    ADD CONSTRAINT "headcount_accuracy_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."headcount_estimates_history"
    ADD CONSTRAINT "headcount_estimates_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."headcount_estimates"
    ADD CONSTRAINT "headcount_estimates_pkey" PRIMARY KEY ("venue_id");



ALTER TABLE ONLY "public"."headcount_signals"
    ADD CONSTRAINT "headcount_signals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."headcounts"
    ADD CONSTRAINT "headcounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."headcounts"
    ADD CONSTRAINT "headcounts_venue_id_night_of_key" UNIQUE ("venue_id", "night_of");



ALTER TABLE ONLY "public"."live_events"
    ADD CONSTRAINT "live_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_redemptions"
    ADD CONSTRAINT "loyalty_redemptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_visits"
    ADD CONSTRAINT "loyalty_visits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_visits"
    ADD CONSTRAINT "loyalty_visits_user_id_venue_id_night_of_key" UNIQUE ("user_id", "venue_id", "night_of");



ALTER TABLE ONLY "public"."nfc_tags"
    ADD CONSTRAINT "nfc_tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nfc_tags"
    ADD CONSTRAINT "nfc_tags_tag_uid_key" UNIQUE ("tag_uid");



ALTER TABLE ONLY "public"."nfc_taps"
    ADD CONSTRAINT "nfc_taps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."night_plans"
    ADD CONSTRAINT "night_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."night_plans"
    ADD CONSTRAINT "night_plans_share_token_key" UNIQUE ("share_token");



ALTER TABLE ONLY "public"."night_ratings"
    ADD CONSTRAINT "night_ratings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."night_ratings"
    ADD CONSTRAINT "night_ratings_plan_id_key" UNIQUE ("plan_id");



ALTER TABLE ONLY "public"."nightly_codes"
    ADD CONSTRAINT "nightly_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."nightly_codes"
    ADD CONSTRAINT "nightly_codes_venue_id_night_of_key" UNIQUE ("venue_id", "night_of");



ALTER TABLE ONLY "public"."organization_venues"
    ADD CONSTRAINT "organization_venues_org_id_venue_id_key" UNIQUE ("org_id", "venue_id");



ALTER TABLE ONLY "public"."organization_venues"
    ADD CONSTRAINT "organization_venues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."paint_prompts"
    ADD CONSTRAINT "paint_prompts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."presence_events"
    ADD CONSTRAINT "presence_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_share_views"
    ADD CONSTRAINT "profile_share_views_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_auth_id_key" UNIQUE ("auth_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_share_token_unique" UNIQUE ("profile_share_token");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."push_tokens"
    ADD CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_tokens"
    ADD CONSTRAINT "push_tokens_user_id_token_key" UNIQUE ("user_id", "token");



ALTER TABLE ONLY "public"."rank_snapshots"
    ADD CONSTRAINT "rank_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rank_snapshots"
    ADD CONSTRAINT "rank_snapshots_profile_id_snapshot_date_key" UNIQUE ("profile_id", "snapshot_date");



ALTER TABLE ONLY "public"."security_organizations"
    ADD CONSTRAINT "security_organizations_org_code_key" UNIQUE ("org_code");



ALTER TABLE ONLY "public"."security_organizations"
    ADD CONSTRAINT "security_organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."signal_weights"
    ADD CONSTRAINT "signal_weights_pkey" PRIMARY KEY ("signal_type");



ALTER TABLE ONLY "public"."stop_ratings"
    ADD CONSTRAINT "stop_ratings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stop_ratings"
    ADD CONSTRAINT "stop_ratings_unique" UNIQUE ("user_id", "plan_id", "stop_index");



ALTER TABLE ONLY "public"."system_config"
    ADD CONSTRAINT "system_config_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_visits"
    ADD CONSTRAINT "user_visits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_visits"
    ADD CONSTRAINT "user_visits_unique" UNIQUE ("user_id", "venue_id", "night_of");



ALTER TABLE ONLY "public"."venny_conversations"
    ADD CONSTRAINT "venny_conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venny_messages"
    ADD CONSTRAINT "venny_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venue_baselines"
    ADD CONSTRAINT "venue_baselines_pkey" PRIMARY KEY ("venue_id");



ALTER TABLE ONLY "public"."venue_comments"
    ADD CONSTRAINT "venue_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venue_recaps"
    ADD CONSTRAINT "venue_recaps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venue_rewards"
    ADD CONSTRAINT "venue_rewards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venue_rewards"
    ADD CONSTRAINT "venue_rewards_venue_id_key" UNIQUE ("venue_id");



ALTER TABLE ONLY "public"."venue_stripe_accounts"
    ADD CONSTRAINT "venue_stripe_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venue_stripe_accounts"
    ADD CONSTRAINT "venue_stripe_accounts_venue_id_key" UNIQUE ("venue_id");



ALTER TABLE ONLY "public"."venue_updates"
    ADD CONSTRAINT "venue_updates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venues"
    ADD CONSTRAINT "venues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."venues"
    ADD CONSTRAINT "venues_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."vibe_hue_lookup"
    ADD CONSTRAINT "vibe_hue_lookup_pkey" PRIMARY KEY ("hue_id");



ALTER TABLE ONLY "public"."vibe_ratings"
    ADD CONSTRAINT "vibe_ratings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vibe_ratings"
    ADD CONSTRAINT "vibe_ratings_user_id_venue_id_key" UNIQUE ("user_id", "venue_id");



CREATE INDEX "event_rsvps_event_id_idx" ON "public"."event_rsvps" USING "btree" ("event_id");



CREATE INDEX "event_rsvps_user_id_idx" ON "public"."event_rsvps" USING "btree" ("user_id");



CREATE INDEX "events_city_start_idx" ON "public"."events" USING "btree" ("city", "start_time") WHERE ("is_active" = true);



CREATE INDEX "events_partner_idx" ON "public"."events" USING "btree" ("featured_partner") WHERE ("is_active" = true);



CREATE INDEX "events_start_time_idx" ON "public"."events" USING "btree" ("start_time") WHERE ("is_active" = true);



CREATE INDEX "globe_snapshots_created_at_idx" ON "public"."globe_snapshots" USING "btree" ("created_at" DESC);



CREATE INDEX "globe_snapshots_user_id_idx" ON "public"."globe_snapshots" USING "btree" ("user_id") WHERE ("user_id" IS NOT NULL);



CREATE INDEX "idx_accuracy_log_match_kind" ON "public"."headcount_accuracy_log" USING "btree" ("match_kind");



CREATE INDEX "idx_accuracy_log_recorded_at" ON "public"."headcount_accuracy_log" USING "btree" ("recorded_at" DESC);



CREATE INDEX "idx_accuracy_log_venue_at" ON "public"."headcount_accuracy_log" USING "btree" ("venue_id", "recorded_at" DESC);



CREATE INDEX "idx_besttime_runs_city_started" ON "public"."besttime_refresh_runs" USING "btree" ("city", "cycle_started_at" DESC);



CREATE INDEX "idx_besttime_runs_started" ON "public"."besttime_refresh_runs" USING "btree" ("cycle_started_at" DESC);



CREATE INDEX "idx_besttime_snapshots_time" ON "public"."besttime_live_snapshots" USING "btree" ("captured_at" DESC);



CREATE INDEX "idx_besttime_snapshots_venue_time" ON "public"."besttime_live_snapshots" USING "btree" ("venue_id", "captured_at" DESC);



CREATE INDEX "idx_cover_configs_active" ON "public"."cover_configs" USING "btree" ("is_active", "night_of");



CREATE INDEX "idx_cover_configs_venue_night" ON "public"."cover_configs" USING "btree" ("venue_id", "night_of");



CREATE INDEX "idx_cover_price_history_config_time" ON "public"."cover_price_history" USING "btree" ("cover_config_id", "recorded_at");



CREATE INDEX "idx_cover_purchases_config" ON "public"."cover_purchases" USING "btree" ("cover_config_id");



CREATE INDEX "idx_cover_purchases_qr" ON "public"."cover_purchases" USING "btree" ("qr_code");



CREATE INDEX "idx_cover_purchases_status" ON "public"."cover_purchases" USING "btree" ("status");



CREATE INDEX "idx_cover_purchases_user" ON "public"."cover_purchases" USING "btree" ("user_id");



CREATE INDEX "idx_cover_purchases_venue" ON "public"."cover_purchases" USING "btree" ("venue_id");



CREATE INDEX "idx_estimates_history_time" ON "public"."headcount_estimates_history" USING "btree" ("computed_at" DESC);



CREATE INDEX "idx_estimates_history_venue_time" ON "public"."headcount_estimates_history" USING "btree" ("venue_id", "computed_at" DESC);



CREATE INDEX "idx_events_active" ON "public"."events" USING "btree" ("is_active", "expires_at");



CREATE INDEX "idx_events_city" ON "public"."events" USING "btree" ("city");



CREATE INDEX "idx_events_start_time" ON "public"."events" USING "btree" ("start_time");



CREATE INDEX "idx_events_venue" ON "public"."events" USING "btree" ("venue_id");



CREATE INDEX "idx_headcount_estimates_calc_time" ON "public"."headcount_estimates" USING "btree" ("last_calculated_at" DESC);



CREATE INDEX "idx_headcount_signals_dedup" ON "public"."headcount_signals" USING "btree" ("source_table", "source_row_id") WHERE (("source_table" IS NOT NULL) AND ("source_row_id" IS NOT NULL));



CREATE INDEX "idx_headcount_signals_user_venue" ON "public"."headcount_signals" USING "btree" ("user_id", "venue_id", "recorded_at" DESC) WHERE ("user_id" IS NOT NULL);



CREATE INDEX "idx_headcount_signals_venue_active" ON "public"."headcount_signals" USING "btree" ("venue_id", "expires_at");



CREATE INDEX "idx_headcount_signals_venue_recorded" ON "public"."headcount_signals" USING "btree" ("venue_id", "recorded_at" DESC);



CREATE INDEX "idx_live_events_city_fired" ON "public"."live_events" USING "btree" ("city", "fired_at" DESC);



CREATE INDEX "idx_live_events_expires" ON "public"."live_events" USING "btree" ("expires_at");



CREATE INDEX "idx_live_events_fired" ON "public"."live_events" USING "btree" ("fired_at" DESC);



CREATE INDEX "idx_live_events_venue_type_fired" ON "public"."live_events" USING "btree" ("venue_id", "event_type", "fired_at" DESC);



CREATE INDEX "idx_loyalty_visits_user_venue" ON "public"."loyalty_visits" USING "btree" ("user_id", "venue_id");



CREATE INDEX "idx_nfc_tags_uid" ON "public"."nfc_tags" USING "btree" ("tag_uid");



CREATE INDEX "idx_nfc_tags_venue" ON "public"."nfc_tags" USING "btree" ("venue_id");



CREATE INDEX "idx_night_plans_active" ON "public"."night_plans" USING "btree" ("user_id", "activated_at" DESC) WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_night_plans_pending_rating" ON "public"."night_plans" USING "btree" ("rating_status", "completed_at") WHERE ("rating_status" = 'pending_morning'::"text");



CREATE INDEX "idx_night_plans_share_token" ON "public"."night_plans" USING "btree" ("share_token") WHERE ("share_token" IS NOT NULL);



CREATE INDEX "idx_night_plans_status_open" ON "public"."night_plans" USING "btree" ("status") WHERE ("status" = ANY (ARRAY['planned'::"text", 'active'::"text"]));



CREATE INDEX "idx_night_plans_user_created" ON "public"."night_plans" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_night_ratings_user" ON "public"."night_ratings" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_nightly_codes_venue_night" ON "public"."nightly_codes" USING "btree" ("venue_id", "night_of");



CREATE INDEX "idx_org_venues_org" ON "public"."organization_venues" USING "btree" ("org_id");



CREATE INDEX "idx_org_venues_venue" ON "public"."organization_venues" USING "btree" ("venue_id");



CREATE INDEX "idx_paint_prompts_queued" ON "public"."paint_prompts" USING "btree" ("fire_not_before") WHERE ("status" = 'queued'::"text");



CREATE INDEX "idx_paint_prompts_user_status" ON "public"."paint_prompts" USING "btree" ("user_id", "status", "created_at" DESC);



CREATE UNIQUE INDEX "idx_paint_prompts_user_visit" ON "public"."paint_prompts" USING "btree" ("user_id", "venue_id", "visit_first_seen_at");



CREATE INDEX "idx_presence_events_user_created" ON "public"."presence_events" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_presence_events_user_venue_created" ON "public"."presence_events" USING "btree" ("user_id", "venue_id", "created_at" DESC);



CREATE INDEX "idx_profile_share_views_profile_viewed" ON "public"."profile_share_views" USING "btree" ("profile_id", "viewed_at" DESC);



CREATE INDEX "idx_profile_share_views_viewer" ON "public"."profile_share_views" USING "btree" ("viewer_user_id") WHERE ("viewer_user_id" IS NOT NULL);



CREATE INDEX "idx_push_tokens_city" ON "public"."push_tokens" USING "btree" ("city");



CREATE INDEX "idx_push_tokens_user" ON "public"."push_tokens" USING "btree" ("user_id");



CREATE INDEX "idx_security_orgs_code" ON "public"."security_organizations" USING "btree" ("org_code");



CREATE INDEX "idx_stop_ratings_plan" ON "public"."stop_ratings" USING "btree" ("plan_id");



CREATE INDEX "idx_stop_ratings_user" ON "public"."stop_ratings" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_stop_ratings_venue" ON "public"."stop_ratings" USING "btree" ("venue_id");



CREATE INDEX "idx_user_preferences_updated" ON "public"."user_preferences" USING "btree" ("updated_at" DESC);



CREATE INDEX "idx_user_visits_passive" ON "public"."user_visits" USING "btree" ("venue_id", "night_of") WHERE ("source" = 'passive'::"text");



CREATE INDEX "idx_user_visits_user_night" ON "public"."user_visits" USING "btree" ("user_id", "night_of" DESC);



CREATE INDEX "idx_user_visits_user_venue" ON "public"."user_visits" USING "btree" ("user_id", "venue_id");



CREATE INDEX "idx_vc_venue_day" ON "public"."venue_comments" USING "btree" ("venue_id", "day_of", "created_at" DESC);



CREATE INDEX "idx_venny_conversations_user_updated" ON "public"."venny_conversations" USING "btree" ("user_id", "updated_at" DESC) WHERE ("user_id" IS NOT NULL);



CREATE INDEX "idx_venny_messages_conversation_created" ON "public"."venny_messages" USING "btree" ("conversation_id", "created_at");



CREATE INDEX "idx_venue_stripe_venue" ON "public"."venue_stripe_accounts" USING "btree" ("venue_id");



CREATE INDEX "idx_venue_updates_created" ON "public"."venue_updates" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_venues_besttime_id" ON "public"."venues" USING "btree" ("besttime_venue_id") WHERE ("besttime_venue_id" IS NOT NULL);



CREATE INDEX "idx_vibe_ratings_painted_at" ON "public"."vibe_ratings" USING "btree" ("painted_at" DESC);



CREATE INDEX "idx_vibe_ratings_user" ON "public"."vibe_ratings" USING "btree" ("user_id");



CREATE INDEX "idx_vibe_ratings_venue" ON "public"."vibe_ratings" USING "btree" ("venue_id");



CREATE INDEX "idx_vr_venue_day" ON "public"."venue_recaps" USING "btree" ("venue_id", "day_of", "created_at" DESC);



CREATE UNIQUE INDEX "moments_unique_per_venue" ON "public"."venue_recaps" USING "btree" ("venue_id", "username");



CREATE OR REPLACE TRIGGER "event_rsvps_count_trigger" AFTER INSERT OR DELETE ON "public"."event_rsvps" FOR EACH ROW EXECUTE FUNCTION "public"."bump_event_going_count"();



CREATE OR REPLACE TRIGGER "trg_evaluate_bouncer" AFTER INSERT ON "public"."headcount_signals" FOR EACH ROW EXECUTE FUNCTION "public"."headcount_signals_evaluate_bouncer"();



CREATE OR REPLACE TRIGGER "trg_headcount_estimates_log_to_history" AFTER INSERT OR UPDATE ON "public"."headcount_estimates" FOR EACH ROW EXECUTE FUNCTION "public"."headcount_estimates_log_to_history"();



CREATE OR REPLACE TRIGGER "trg_paint_prompts_touch" BEFORE UPDATE ON "public"."paint_prompts" FOR EACH ROW EXECUTE FUNCTION "public"."touch_paint_prompts_updated_at"();



ALTER TABLE ONLY "public"."besttime_live_snapshots"
    ADD CONSTRAINT "besttime_live_snapshots_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checkins"
    ADD CONSTRAINT "checkins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checkins"
    ADD CONSTRAINT "checkins_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clicker_logs"
    ADD CONSTRAINT "clicker_logs_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cover_configs"
    ADD CONSTRAINT "cover_configs_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cover_price_history"
    ADD CONSTRAINT "cover_price_history_cover_config_id_fkey" FOREIGN KEY ("cover_config_id") REFERENCES "public"."cover_configs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cover_purchases"
    ADD CONSTRAINT "cover_purchases_cover_config_id_fkey" FOREIGN KEY ("cover_config_id") REFERENCES "public"."cover_configs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cover_purchases"
    ADD CONSTRAINT "cover_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cover_purchases"
    ADD CONSTRAINT "cover_purchases_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_rsvps"
    ADD CONSTRAINT "event_rsvps_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_rsvps"
    ADD CONSTRAINT "event_rsvps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."globe_snapshots"
    ADD CONSTRAINT "globe_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."headcount_accuracy_log"
    ADD CONSTRAINT "headcount_accuracy_log_bouncer_signal_id_fkey" FOREIGN KEY ("bouncer_signal_id") REFERENCES "public"."headcount_signals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."headcount_accuracy_log"
    ADD CONSTRAINT "headcount_accuracy_log_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."headcount_estimates"
    ADD CONSTRAINT "headcount_estimates_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."headcount_signals"
    ADD CONSTRAINT "headcount_signals_signal_type_fkey" FOREIGN KEY ("signal_type") REFERENCES "public"."signal_weights"("signal_type");



ALTER TABLE ONLY "public"."headcount_signals"
    ADD CONSTRAINT "headcount_signals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."headcount_signals"
    ADD CONSTRAINT "headcount_signals_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."headcounts"
    ADD CONSTRAINT "headcounts_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."live_events"
    ADD CONSTRAINT "live_events_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_redemptions"
    ADD CONSTRAINT "loyalty_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_redemptions"
    ADD CONSTRAINT "loyalty_redemptions_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_visits"
    ADD CONSTRAINT "loyalty_visits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_visits"
    ADD CONSTRAINT "loyalty_visits_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nfc_tags"
    ADD CONSTRAINT "nfc_tags_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nfc_taps"
    ADD CONSTRAINT "nfc_taps_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."nfc_tags"("id");



ALTER TABLE ONLY "public"."nfc_taps"
    ADD CONSTRAINT "nfc_taps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."nfc_taps"
    ADD CONSTRAINT "nfc_taps_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id");



ALTER TABLE ONLY "public"."night_plans"
    ADD CONSTRAINT "night_plans_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."venny_conversations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."night_plans"
    ADD CONSTRAINT "night_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."night_ratings"
    ADD CONSTRAINT "night_ratings_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."night_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."night_ratings"
    ADD CONSTRAINT "night_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."nightly_codes"
    ADD CONSTRAINT "nightly_codes_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_venues"
    ADD CONSTRAINT "organization_venues_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."security_organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_venues"
    ADD CONSTRAINT "organization_venues_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."paint_prompts"
    ADD CONSTRAINT "paint_prompts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."paint_prompts"
    ADD CONSTRAINT "paint_prompts_user_visit_id_fkey" FOREIGN KEY ("user_visit_id") REFERENCES "public"."user_visits"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."paint_prompts"
    ADD CONSTRAINT "paint_prompts_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."paint_prompts"
    ADD CONSTRAINT "paint_prompts_vibe_rating_id_fkey" FOREIGN KEY ("vibe_rating_id") REFERENCES "public"."vibe_ratings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."presence_events"
    ADD CONSTRAINT "presence_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."presence_events"
    ADD CONSTRAINT "presence_events_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_share_views"
    ADD CONSTRAINT "profile_share_views_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_share_views"
    ADD CONSTRAINT "profile_share_views_viewer_user_id_fkey" FOREIGN KEY ("viewer_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."push_tokens"
    ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stop_ratings"
    ADD CONSTRAINT "stop_ratings_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."night_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stop_ratings"
    ADD CONSTRAINT "stop_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stop_ratings"
    ADD CONSTRAINT "stop_ratings_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_visits"
    ADD CONSTRAINT "user_visits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_visits"
    ADD CONSTRAINT "user_visits_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venny_conversations"
    ADD CONSTRAINT "venny_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."venny_messages"
    ADD CONSTRAINT "venny_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."venny_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venue_baselines"
    ADD CONSTRAINT "venue_baselines_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venue_comments"
    ADD CONSTRAINT "venue_comments_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venue_recaps"
    ADD CONSTRAINT "venue_recaps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venue_recaps"
    ADD CONSTRAINT "venue_recaps_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venue_rewards"
    ADD CONSTRAINT "venue_rewards_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venue_stripe_accounts"
    ADD CONSTRAINT "venue_stripe_accounts_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venue_updates"
    ADD CONSTRAINT "venue_updates_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venues"
    ADD CONSTRAINT "venues_canonical_hue_id_fkey" FOREIGN KEY ("canonical_hue_id") REFERENCES "public"."vibe_hue_lookup"("hue_id");



ALTER TABLE ONLY "public"."venues"
    ADD CONSTRAINT "venues_tenant_of_fkey" FOREIGN KEY ("tenant_of") REFERENCES "public"."venues"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vibe_ratings"
    ADD CONSTRAINT "vibe_ratings_hue_id_fkey" FOREIGN KEY ("hue_id") REFERENCES "public"."vibe_hue_lookup"("hue_id");



ALTER TABLE ONLY "public"."vibe_ratings"
    ADD CONSTRAINT "vibe_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vibe_ratings"
    ADD CONSTRAINT "vibe_ratings_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vibe_ratings"
    ADD CONSTRAINT "vibe_ratings_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "public"."user_visits"("id") ON DELETE SET NULL;



CREATE POLICY "Anonymous can insert guest snapshots" ON "public"."globe_snapshots" FOR INSERT TO "anon" WITH CHECK (("user_id" IS NULL));



CREATE POLICY "Authenticated users can buy covers" ON "public"."cover_purchases" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Authenticated users can create events" ON "public"."events" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Authenticated users can log taps" ON "public"."nfc_taps" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Public read access" ON "public"."vibe_hue_lookup" FOR SELECT USING (true);



CREATE POLICY "Public read access for estimates" ON "public"."headcount_estimates" FOR SELECT USING (true);



CREATE POLICY "Public read snapshots" ON "public"."globe_snapshots" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Service role can create events" ON "public"."events" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "Service role can insert nightly codes" ON "public"."nightly_codes" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "Service role can update events" ON "public"."events" FOR UPDATE TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role can update nightly codes" ON "public"."nightly_codes" FOR UPDATE TO "service_role" USING (true);



CREATE POLICY "Users can insert their own redemptions" ON "public"."loyalty_redemptions" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can insert their own snapshots" ON "public"."globe_snapshots" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") OR ("user_id" IS NULL)));



CREATE POLICY "Users can insert their own visits" ON "public"."loyalty_visits" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can manage their own tokens" ON "public"."push_tokens" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can read own purchases" ON "public"."cover_purchases" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can read their own redemptions" ON "public"."loyalty_redemptions" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can read their own visits" ON "public"."loyalty_visits" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users create own conversations" ON "public"."venny_conversations" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") OR ("user_id" IS NULL)));



CREATE POLICY "Users read own conversations" ON "public"."venny_conversations" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users read own messages" ON "public"."venny_messages" FOR SELECT TO "authenticated" USING (("conversation_id" IN ( SELECT "venny_conversations"."id"
   FROM "public"."venny_conversations"
  WHERE ("venny_conversations"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users read own preferences" ON "public"."user_preferences" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users update own preferences" ON "public"."user_preferences" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users upsert own preferences" ON "public"."user_preferences" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "anon read app_config" ON "public"."app_config" FOR SELECT TO "anon" USING (true);



CREATE POLICY "anyone can read app_config" ON "public"."app_config" FOR SELECT USING (true);



ALTER TABLE "public"."app_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."besttime_collections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."besttime_live_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."besttime_refresh_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chat_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."checkins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clicker_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cover_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cover_price_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cover_purchases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "delete_checkins_self" ON "public"."checkins" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "delete_own_moment" ON "public"."venue_recaps" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "emergency_read_clicker_logs" ON "public"."clicker_logs" FOR SELECT USING (true);



CREATE POLICY "emergency_read_cover_configs" ON "public"."cover_configs" FOR SELECT USING (true);



CREATE POLICY "emergency_read_cover_price_history" ON "public"."cover_price_history" FOR SELECT USING (true);



CREATE POLICY "emergency_read_events" ON "public"."events" FOR SELECT USING (true);



CREATE POLICY "emergency_read_headcounts" ON "public"."headcounts" FOR SELECT USING (true);



CREATE POLICY "emergency_read_org_venues" ON "public"."organization_venues" FOR SELECT USING (true);



CREATE POLICY "emergency_read_profiles" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "emergency_read_security_orgs" ON "public"."security_organizations" FOR SELECT USING (true);



CREATE POLICY "emergency_read_venue_rewards" ON "public"."venue_rewards" FOR SELECT USING (true);



CREATE POLICY "emergency_read_venue_updates" ON "public"."venue_updates" FOR SELECT USING (true);



CREATE POLICY "emergency_read_venues" ON "public"."venues" FOR SELECT USING (true);



ALTER TABLE "public"."event_rsvps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."globe_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."headcount_accuracy_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."headcount_estimates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."headcount_estimates_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "headcount_estimates_read_all" ON "public"."headcount_estimates" FOR SELECT USING (true);



ALTER TABLE "public"."headcount_signals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "headcount_signals_no_public_access" ON "public"."headcount_signals" FOR SELECT USING (false);



ALTER TABLE "public"."headcounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "insert_chat_authed" ON "public"."chat_messages" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "insert_checkins_self" ON "public"."checkins" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "insert_profiles_self" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("auth_id" = "auth"."uid"()));



CREATE POLICY "insert_vc_authed" ON "public"."venue_comments" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) OR ("user_id" IS NULL)));



ALTER TABLE "public"."live_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "live_events_read_all" ON "public"."live_events" FOR SELECT USING (true);



ALTER TABLE "public"."loyalty_redemptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_visits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nfc_tags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nfc_taps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."night_plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "night_plans_owner" ON "public"."night_plans" TO "authenticated" USING ((("auth"."uid"())::"text" = ( SELECT ("profiles"."auth_id")::"text" AS "auth_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "night_plans"."user_id")))) WITH CHECK ((("auth"."uid"())::"text" = ( SELECT ("profiles"."auth_id")::"text" AS "auth_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "night_plans"."user_id"))));



CREATE POLICY "night_plans_public_share" ON "public"."night_plans" FOR SELECT TO "authenticated", "anon" USING (("share_token" IS NOT NULL));



ALTER TABLE "public"."night_ratings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "night_ratings_owner_insert" ON "public"."night_ratings" FOR INSERT TO "authenticated" WITH CHECK (("user_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_id" = "auth"."uid"()))));



CREATE POLICY "night_ratings_owner_select" ON "public"."night_ratings" FOR SELECT TO "authenticated" USING (("user_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_id" = "auth"."uid"()))));



CREATE POLICY "night_ratings_owner_update" ON "public"."night_ratings" FOR UPDATE TO "authenticated" USING (("user_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_id" = "auth"."uid"()))));



ALTER TABLE "public"."nightly_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_venues" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."paint_prompts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "paint_prompts_owner_select" ON "public"."paint_prompts" FOR SELECT USING (("auth"."uid"() IN ( SELECT "profiles"."auth_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "paint_prompts"."user_id"))));



ALTER TABLE "public"."presence_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "presence_events_owner_insert" ON "public"."presence_events" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"())::"text" = ( SELECT ("profiles"."auth_id")::"text" AS "auth_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "presence_events"."user_id"))));



CREATE POLICY "presence_events_owner_select" ON "public"."presence_events" FOR SELECT TO "authenticated" USING ((("auth"."uid"())::"text" = ( SELECT ("profiles"."auth_id")::"text" AS "auth_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "presence_events"."user_id"))));



ALTER TABLE "public"."profile_share_views" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public_view_insert" ON "public"."profile_share_views" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



ALTER TABLE "public"."push_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rank_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read_chat" ON "public"."chat_messages" FOR SELECT USING (true);



CREATE POLICY "read_checkins" ON "public"."checkins" FOR SELECT USING (true);



CREATE POLICY "read_developed_moments" ON "public"."venue_recaps" FOR SELECT USING (("developed_at" <= "now"()));



CREATE POLICY "read_own_developing" ON "public"."venue_recaps" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "read_vc" ON "public"."venue_comments" FOR SELECT USING (true);



CREATE POLICY "rsvps delete own" ON "public"."event_rsvps" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "rsvps insert own" ON "public"."event_rsvps" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "rsvps read all" ON "public"."event_rsvps" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."security_organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_role can delete events" ON "public"."events" FOR DELETE TO "service_role" USING (true);



CREATE POLICY "service_role full access cover_purchases" ON "public"."cover_purchases" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role full access venue_stripe_accounts" ON "public"."venue_stripe_accounts" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role reads nfc_tags" ON "public"."nfc_tags" FOR SELECT TO "service_role" USING (true);



CREATE POLICY "service_role reads push_tokens" ON "public"."push_tokens" FOR SELECT TO "service_role" USING (true);



CREATE POLICY "service_role writes clicker_logs" ON "public"."clicker_logs" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "service_role writes cover_configs" ON "public"."cover_configs" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role writes headcounts" ON "public"."headcounts" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role writes organization_venues" ON "public"."organization_venues" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role writes price history" ON "public"."cover_price_history" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "service_role writes security_organizations" ON "public"."security_organizations" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role writes venue_rewards" ON "public"."venue_rewards" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "service_role writes venue_updates" ON "public"."venue_updates" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."signal_weights" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "signal_weights_read_all" ON "public"."signal_weights" FOR SELECT USING (true);



ALTER TABLE "public"."stop_ratings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stop_ratings_owner_delete" ON "public"."stop_ratings" FOR DELETE TO "authenticated" USING (("user_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_id" = "auth"."uid"()))));



CREATE POLICY "stop_ratings_owner_insert" ON "public"."stop_ratings" FOR INSERT TO "authenticated" WITH CHECK (("user_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_id" = "auth"."uid"()))));



CREATE POLICY "stop_ratings_owner_select" ON "public"."stop_ratings" FOR SELECT TO "authenticated" USING (("user_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_id" = "auth"."uid"()))));



CREATE POLICY "stop_ratings_owner_update" ON "public"."stop_ratings" FOR UPDATE TO "authenticated" USING (("user_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_id" = "auth"."uid"()))));



ALTER TABLE "public"."system_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "update_checkins_self" ON "public"."checkins" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "update_own_moment" ON "public"."venue_recaps" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "update_profiles_self" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth_id" = "auth"."uid"())) WITH CHECK (("auth_id" = "auth"."uid"()));



ALTER TABLE "public"."user_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_visits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_visits_owner_select" ON "public"."user_visits" FOR SELECT TO "authenticated" USING ((("auth"."uid"())::"text" = ( SELECT ("profiles"."auth_id")::"text" AS "auth_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "user_visits"."user_id"))));



CREATE POLICY "user_visits_owner_update" ON "public"."user_visits" FOR UPDATE TO "authenticated" USING ((("auth"."uid"())::"text" = ( SELECT ("profiles"."auth_id")::"text" AS "auth_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "user_visits"."user_id")))) WITH CHECK ((("auth"."uid"())::"text" = ( SELECT ("profiles"."auth_id")::"text" AS "auth_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "user_visits"."user_id"))));



CREATE POLICY "user_visits_owner_write" ON "public"."user_visits" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"())::"text" = ( SELECT ("profiles"."auth_id")::"text" AS "auth_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "user_visits"."user_id"))));



ALTER TABLE "public"."venny_conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."venny_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."venue_baselines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "venue_baselines_read_all" ON "public"."venue_baselines" FOR SELECT USING (true);



ALTER TABLE "public"."venue_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."venue_recaps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."venue_rewards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."venue_stripe_accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."venue_updates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."venues" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vibe_hue_lookup" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vibe_ratings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vibe_ratings_owner_insert" ON "public"."vibe_ratings" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "vibe_ratings_owner_select" ON "public"."vibe_ratings" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "view_owner_select" ON "public"."profile_share_views" FOR SELECT TO "authenticated" USING (("profile_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE ("profiles"."auth_id" = "auth"."uid"()))));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."chat_messages";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."checkins";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."headcount_estimates";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."headcounts";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."live_events";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."paint_prompts";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."venue_comments";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."venue_recaps";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."venue_updates";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."venues";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."vibe_ratings";









GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































GRANT ALL ON FUNCTION "public"."adjust_headcount"("target_venue" "uuid", "target_city" character varying, "target_night" "date", "adjustment" integer, "staff_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."adjust_headcount"("target_venue" "uuid", "target_city" character varying, "target_night" "date", "adjustment" integer, "staff_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."adjust_headcount"("target_venue" "uuid", "target_city" character varying, "target_night" "date", "adjustment" integer, "staff_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."bump_event_going_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."bump_event_going_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bump_event_going_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."category_default_pct"("p_category" "text", "p_hour" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."category_default_pct"("p_category" "text", "p_hour" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."category_default_pct"("p_category" "text", "p_hour" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."clean_expired_events"() TO "anon";
GRANT ALL ON FUNCTION "public"."clean_expired_events"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."clean_expired_events"() TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_paint_prompt_due"("p_user_visit_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."compute_paint_prompt_due"("p_user_visit_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_paint_prompt_due"("p_user_visit_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_venue_estimate"("p_venue_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."compute_venue_estimate"("p_venue_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_venue_estimate"("p_venue_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."current_time_band"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_time_band"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_time_band"() TO "service_role";



GRANT ALL ON FUNCTION "public"."decrement_headcount"("target_venue" "uuid", "target_city" character varying, "target_night" "date", "staff_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."decrement_headcount"("target_venue" "uuid", "target_city" character varying, "target_night" "date", "staff_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."decrement_headcount"("target_venue" "uuid", "target_city" character varying, "target_night" "date", "staff_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_user_account"() TO "anon";
GRANT ALL ON FUNCTION "public"."delete_user_account"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_user_account"() TO "service_role";



GRANT ALL ON FUNCTION "public"."derive_true_state"("p_count" integer, "p_effective_capacity" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."derive_true_state"("p_count" integer, "p_effective_capacity" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."derive_true_state"("p_count" integer, "p_effective_capacity" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."detect_and_record_events"("p_venue_id" "uuid", "p_current_estimate" integer, "p_current_state_label" "text", "p_prior_estimate" integer, "p_capacity_pct" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."detect_and_record_events"("p_venue_id" "uuid", "p_current_estimate" integer, "p_current_state_label" "text", "p_prior_estimate" integer, "p_capacity_pct" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."detect_and_record_events"("p_venue_id" "uuid", "p_current_estimate" integer, "p_current_state_label" "text", "p_prior_estimate" integer, "p_capacity_pct" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."evaluate_bouncer_truth_signal"("p_signal_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."evaluate_bouncer_truth_signal"("p_signal_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."evaluate_bouncer_truth_signal"("p_signal_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."expire_stale_paint_prompts"() TO "anon";
GRANT ALL ON FUNCTION "public"."expire_stale_paint_prompts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."expire_stale_paint_prompts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."find_dangling_enters"("p_cutoff" timestamp with time zone, "p_stalemark" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."find_dangling_enters"("p_cutoff" timestamp with time zone, "p_stalemark" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_dangling_enters"("p_cutoff" timestamp with time zone, "p_stalemark" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."fuse_all_active_venues"() TO "anon";
GRANT ALL ON FUNCTION "public"."fuse_all_active_venues"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fuse_all_active_venues"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_active_signals"("p_venue_id" "uuid", "p_since_minutes" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_active_signals"("p_venue_id" "uuid", "p_since_minutes" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_active_signals"("p_venue_id" "uuid", "p_since_minutes" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_current_hour_from_curve"("p_venue_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_current_hour_from_curve"("p_venue_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_current_hour_from_curve"("p_venue_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_current_hour_from_manual_curve"("p_venue_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_current_hour_from_manual_curve"("p_venue_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_current_hour_from_manual_curve"("p_venue_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_venue_baseline_hue"("p_venue_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_venue_baseline_hue"("p_venue_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_venue_baseline_hue"("p_venue_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_venue_current_hue"("p_venue_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_venue_current_hue"("p_venue_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_venue_current_hue"("p_venue_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_venue_current_hue_degrees"("p_venue_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_venue_current_hue_degrees"("p_venue_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_venue_current_hue_degrees"("p_venue_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_vibe_canvas_points"("p_city" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_vibe_canvas_points"("p_city" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_vibe_canvas_points"("p_city" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."headcount_estimates_log_to_history"() TO "anon";
GRANT ALL ON FUNCTION "public"."headcount_estimates_log_to_history"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."headcount_estimates_log_to_history"() TO "service_role";



GRANT ALL ON FUNCTION "public"."headcount_signals_evaluate_bouncer"() TO "anon";
GRANT ALL ON FUNCTION "public"."headcount_signals_evaluate_bouncer"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."headcount_signals_evaluate_bouncer"() TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_headcount"("target_venue" "uuid", "target_city" character varying, "target_night" "date", "staff_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_headcount"("target_venue" "uuid", "target_city" character varying, "target_night" "date", "staff_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_headcount"("target_venue" "uuid", "target_city" character varying, "target_night" "date", "staff_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."record_paint"("p_venue_id" "uuid", "p_hue_id" integer, "p_visit_first_seen_at" timestamp with time zone, "p_paint_prompt_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."record_paint"("p_venue_id" "uuid", "p_hue_id" integer, "p_visit_first_seen_at" timestamp with time zone, "p_paint_prompt_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_paint"("p_venue_id" "uuid", "p_hue_id" integer, "p_visit_first_seen_at" timestamp with time zone, "p_paint_prompt_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."record_signal"("p_venue_id" "uuid", "p_user_id" "uuid", "p_signal_type" "text", "p_signal_value" numeric, "p_source_table" "text", "p_source_row_id" "uuid", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."record_signal"("p_venue_id" "uuid", "p_user_id" "uuid", "p_signal_type" "text", "p_signal_value" numeric, "p_source_table" "text", "p_source_row_id" "uuid", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_signal"("p_venue_id" "uuid", "p_user_id" "uuid", "p_signal_type" "text", "p_signal_value" numeric, "p_source_table" "text", "p_source_row_id" "uuid", "p_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."record_venue_checkin"("p_user_id" "uuid", "p_venue_id" "uuid", "p_source" "text", "p_user_lat" numeric, "p_user_lng" numeric, "p_device_id" "text", "p_nfc_password" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."record_venue_checkin"("p_user_id" "uuid", "p_venue_id" "uuid", "p_source" "text", "p_user_lat" numeric, "p_user_lng" numeric, "p_device_id" "text", "p_nfc_password" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_venue_checkin"("p_user_id" "uuid", "p_venue_id" "uuid", "p_source" "text", "p_user_lat" numeric, "p_user_lng" numeric, "p_device_id" "text", "p_nfc_password" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."snapshot_venuu_ranks"() TO "anon";
GRANT ALL ON FUNCTION "public"."snapshot_venuu_ranks"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."snapshot_venuu_ranks"() TO "service_role";



GRANT ALL ON FUNCTION "public"."state_label_rank"("p_state" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."state_label_rank"("p_state" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."state_label_rank"("p_state" "text") TO "service_role";



GRANT ALL ON TABLE "public"."venue_recaps" TO "anon";
GRANT ALL ON TABLE "public"."venue_recaps" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_recaps" TO "service_role";



GRANT ALL ON FUNCTION "public"."submit_moment"("p_venue_id" "uuid", "p_username" "text", "p_photo_url" "text", "p_hue_at_capture" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_moment"("p_venue_id" "uuid", "p_username" "text", "p_photo_url" "text", "p_hue_at_capture" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_paint_prompts_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_paint_prompts_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_paint_prompts_updated_at"() TO "service_role";
























GRANT ALL ON TABLE "public"."app_config" TO "anon";
GRANT ALL ON TABLE "public"."app_config" TO "authenticated";
GRANT ALL ON TABLE "public"."app_config" TO "service_role";



GRANT ALL ON TABLE "public"."besttime_collections" TO "anon";
GRANT ALL ON TABLE "public"."besttime_collections" TO "authenticated";
GRANT ALL ON TABLE "public"."besttime_collections" TO "service_role";



GRANT ALL ON TABLE "public"."besttime_live_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."besttime_live_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."besttime_live_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."besttime_refresh_runs" TO "anon";
GRANT ALL ON TABLE "public"."besttime_refresh_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."besttime_refresh_runs" TO "service_role";



GRANT ALL ON TABLE "public"."chat_messages" TO "anon";
GRANT ALL ON TABLE "public"."chat_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_messages" TO "service_role";



GRANT ALL ON TABLE "public"."checkins" TO "anon";
GRANT ALL ON TABLE "public"."checkins" TO "authenticated";
GRANT ALL ON TABLE "public"."checkins" TO "service_role";



GRANT ALL ON TABLE "public"."headcount_estimates" TO "anon";
GRANT ALL ON TABLE "public"."headcount_estimates" TO "authenticated";
GRANT ALL ON TABLE "public"."headcount_estimates" TO "service_role";



GRANT ALL ON TABLE "public"."venues" TO "anon";
GRANT ALL ON TABLE "public"."venues" TO "authenticated";
GRANT ALL ON TABLE "public"."venues" TO "service_role";



GRANT ALL ON TABLE "public"."city_aggregates" TO "anon";
GRANT ALL ON TABLE "public"."city_aggregates" TO "authenticated";
GRANT ALL ON TABLE "public"."city_aggregates" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."user_visits" TO "anon";
GRANT ALL ON TABLE "public"."user_visits" TO "authenticated";
GRANT ALL ON TABLE "public"."user_visits" TO "service_role";



GRANT ALL ON TABLE "public"."city_leaderboard" TO "anon";
GRANT ALL ON TABLE "public"."city_leaderboard" TO "authenticated";
GRANT ALL ON TABLE "public"."city_leaderboard" TO "service_role";



GRANT ALL ON TABLE "public"."city_pulse" TO "anon";
GRANT ALL ON TABLE "public"."city_pulse" TO "authenticated";
GRANT ALL ON TABLE "public"."city_pulse" TO "service_role";



GRANT ALL ON TABLE "public"."clicker_logs" TO "anon";
GRANT ALL ON TABLE "public"."clicker_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."clicker_logs" TO "service_role";



GRANT ALL ON TABLE "public"."cover_configs" TO "anon";
GRANT ALL ON TABLE "public"."cover_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."cover_configs" TO "service_role";



GRANT ALL ON TABLE "public"."cover_price_history" TO "anon";
GRANT ALL ON TABLE "public"."cover_price_history" TO "authenticated";
GRANT ALL ON TABLE "public"."cover_price_history" TO "service_role";



GRANT ALL ON TABLE "public"."cover_purchases" TO "anon";
GRANT ALL ON TABLE "public"."cover_purchases" TO "authenticated";
GRANT ALL ON TABLE "public"."cover_purchases" TO "service_role";



GRANT ALL ON TABLE "public"."headcount_accuracy_log" TO "anon";
GRANT ALL ON TABLE "public"."headcount_accuracy_log" TO "authenticated";
GRANT ALL ON TABLE "public"."headcount_accuracy_log" TO "service_role";



GRANT ALL ON TABLE "public"."engine_accuracy_by_baseline" TO "anon";
GRANT ALL ON TABLE "public"."engine_accuracy_by_baseline" TO "authenticated";
GRANT ALL ON TABLE "public"."engine_accuracy_by_baseline" TO "service_role";



GRANT ALL ON TABLE "public"."engine_accuracy_by_city" TO "anon";
GRANT ALL ON TABLE "public"."engine_accuracy_by_city" TO "authenticated";
GRANT ALL ON TABLE "public"."engine_accuracy_by_city" TO "service_role";



GRANT ALL ON TABLE "public"."engine_accuracy_by_venue" TO "anon";
GRANT ALL ON TABLE "public"."engine_accuracy_by_venue" TO "authenticated";
GRANT ALL ON TABLE "public"."engine_accuracy_by_venue" TO "service_role";



GRANT ALL ON TABLE "public"."engine_accuracy_overall" TO "anon";
GRANT ALL ON TABLE "public"."engine_accuracy_overall" TO "authenticated";
GRANT ALL ON TABLE "public"."engine_accuracy_overall" TO "service_role";



GRANT ALL ON TABLE "public"."event_rsvps" TO "anon";
GRANT ALL ON TABLE "public"."event_rsvps" TO "authenticated";
GRANT ALL ON TABLE "public"."event_rsvps" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."globe_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."globe_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."globe_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."headcount_estimates_history" TO "anon";
GRANT ALL ON TABLE "public"."headcount_estimates_history" TO "authenticated";
GRANT ALL ON TABLE "public"."headcount_estimates_history" TO "service_role";



GRANT ALL ON TABLE "public"."headcount_signals" TO "anon";
GRANT ALL ON TABLE "public"."headcount_signals" TO "authenticated";
GRANT ALL ON TABLE "public"."headcount_signals" TO "service_role";



GRANT ALL ON TABLE "public"."headcounts" TO "anon";
GRANT ALL ON TABLE "public"."headcounts" TO "authenticated";
GRANT ALL ON TABLE "public"."headcounts" TO "service_role";



GRANT ALL ON TABLE "public"."vibe_hue_lookup" TO "anon";
GRANT ALL ON TABLE "public"."vibe_hue_lookup" TO "authenticated";
GRANT ALL ON TABLE "public"."vibe_hue_lookup" TO "service_role";



GRANT ALL ON TABLE "public"."heat_points" TO "anon";
GRANT ALL ON TABLE "public"."heat_points" TO "authenticated";
GRANT ALL ON TABLE "public"."heat_points" TO "service_role";



GRANT ALL ON TABLE "public"."live_events" TO "anon";
GRANT ALL ON TABLE "public"."live_events" TO "authenticated";
GRANT ALL ON TABLE "public"."live_events" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_redemptions" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_redemptions" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_redemptions" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_visits" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_visits" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_visits" TO "service_role";



GRANT ALL ON TABLE "public"."nfc_tags" TO "anon";
GRANT ALL ON TABLE "public"."nfc_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."nfc_tags" TO "service_role";



GRANT ALL ON TABLE "public"."nfc_taps" TO "anon";
GRANT ALL ON TABLE "public"."nfc_taps" TO "authenticated";
GRANT ALL ON TABLE "public"."nfc_taps" TO "service_role";



GRANT ALL ON TABLE "public"."night_plans" TO "anon";
GRANT ALL ON TABLE "public"."night_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."night_plans" TO "service_role";



GRANT ALL ON TABLE "public"."night_ratings" TO "anon";
GRANT ALL ON TABLE "public"."night_ratings" TO "authenticated";
GRANT ALL ON TABLE "public"."night_ratings" TO "service_role";



GRANT ALL ON TABLE "public"."nightly_codes" TO "anon";
GRANT ALL ON TABLE "public"."nightly_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."nightly_codes" TO "service_role";



GRANT ALL ON TABLE "public"."organization_venues" TO "anon";
GRANT ALL ON TABLE "public"."organization_venues" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_venues" TO "service_role";



GRANT ALL ON TABLE "public"."paint_prompts" TO "anon";
GRANT ALL ON TABLE "public"."paint_prompts" TO "authenticated";
GRANT ALL ON TABLE "public"."paint_prompts" TO "service_role";



GRANT ALL ON TABLE "public"."presence_events" TO "anon";
GRANT ALL ON TABLE "public"."presence_events" TO "authenticated";
GRANT ALL ON TABLE "public"."presence_events" TO "service_role";



GRANT ALL ON TABLE "public"."profile_share_views" TO "anon";
GRANT ALL ON TABLE "public"."profile_share_views" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_share_views" TO "service_role";



GRANT ALL ON TABLE "public"."user_account_stats" TO "anon";
GRANT ALL ON TABLE "public"."user_account_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."user_account_stats" TO "service_role";



GRANT ALL ON TABLE "public"."public_profile_view" TO "anon";
GRANT ALL ON TABLE "public"."public_profile_view" TO "authenticated";
GRANT ALL ON TABLE "public"."public_profile_view" TO "service_role";



GRANT ALL ON TABLE "public"."push_tokens" TO "anon";
GRANT ALL ON TABLE "public"."push_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."push_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."rank_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."rank_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."rank_snapshots" TO "service_role";



GRANT ALL ON SEQUENCE "public"."rank_snapshots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."rank_snapshots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."rank_snapshots_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."security_organizations" TO "anon";
GRANT ALL ON TABLE "public"."security_organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."security_organizations" TO "service_role";



GRANT ALL ON TABLE "public"."signal_weights" TO "anon";
GRANT ALL ON TABLE "public"."signal_weights" TO "authenticated";
GRANT ALL ON TABLE "public"."signal_weights" TO "service_role";



GRANT ALL ON TABLE "public"."stop_ratings" TO "anon";
GRANT ALL ON TABLE "public"."stop_ratings" TO "authenticated";
GRANT ALL ON TABLE "public"."stop_ratings" TO "service_role";



GRANT ALL ON TABLE "public"."system_config" TO "anon";
GRANT ALL ON TABLE "public"."system_config" TO "authenticated";
GRANT ALL ON TABLE "public"."system_config" TO "service_role";



GRANT ALL ON TABLE "public"."tonight_movers" TO "anon";
GRANT ALL ON TABLE "public"."tonight_movers" TO "authenticated";
GRANT ALL ON TABLE "public"."tonight_movers" TO "service_role";



GRANT ALL ON TABLE "public"."user_preferences" TO "anon";
GRANT ALL ON TABLE "public"."user_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."user_venuu_rank" TO "anon";
GRANT ALL ON TABLE "public"."user_venuu_rank" TO "authenticated";
GRANT ALL ON TABLE "public"."user_venuu_rank" TO "service_role";



GRANT ALL ON TABLE "public"."user_rank_movement" TO "anon";
GRANT ALL ON TABLE "public"."user_rank_movement" TO "authenticated";
GRANT ALL ON TABLE "public"."user_rank_movement" TO "service_role";



GRANT ALL ON TABLE "public"."venny_conversations" TO "anon";
GRANT ALL ON TABLE "public"."venny_conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."venny_conversations" TO "service_role";



GRANT ALL ON TABLE "public"."venny_messages" TO "anon";
GRANT ALL ON TABLE "public"."venny_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."venny_messages" TO "service_role";



GRANT ALL ON TABLE "public"."venue_baselines" TO "anon";
GRANT ALL ON TABLE "public"."venue_baselines" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_baselines" TO "service_role";



GRANT ALL ON TABLE "public"."venue_comments" TO "anon";
GRANT ALL ON TABLE "public"."venue_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_comments" TO "service_role";



GRANT ALL ON TABLE "public"."venue_leaderboard" TO "anon";
GRANT ALL ON TABLE "public"."venue_leaderboard" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_leaderboard" TO "service_role";



GRANT ALL ON TABLE "public"."venue_rewards" TO "anon";
GRANT ALL ON TABLE "public"."venue_rewards" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_rewards" TO "service_role";



GRANT ALL ON TABLE "public"."venue_stripe_accounts" TO "anon";
GRANT ALL ON TABLE "public"."venue_stripe_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_stripe_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."venue_updates" TO "anon";
GRANT ALL ON TABLE "public"."venue_updates" TO "authenticated";
GRANT ALL ON TABLE "public"."venue_updates" TO "service_role";



GRANT ALL ON TABLE "public"."vibe_ratings" TO "anon";
GRANT ALL ON TABLE "public"."vibe_ratings" TO "authenticated";
GRANT ALL ON TABLE "public"."vibe_ratings" TO "service_role";



GRANT ALL ON TABLE "public"."vibe_canvas_points" TO "anon";
GRANT ALL ON TABLE "public"."vibe_canvas_points" TO "authenticated";
GRANT ALL ON TABLE "public"."vibe_canvas_points" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































