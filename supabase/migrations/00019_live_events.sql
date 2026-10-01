-- ═══════════════════════════════════════════════════════════════
-- 00019_live_events.sql
--
-- The events layer of the prediction engine. Once per fusion cycle
-- compute_venue_estimate calls detect_and_record_events, which decides
-- whether the venue's current state crosses a "moment of significance"
-- threshold (first surge of the night, rapid rise, social pulse) and
-- writes an immutable row to public.live_events. Frontend subscribes
-- via supabase_realtime and pops a toast.
--
-- Cooldowns prevent flooding: each event type has its own per-venue
-- and per-city dedup window.
--
-- Idempotent. Wrapped in BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- live_events table
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.live_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN (
    'surge_first', 'surge_rapid_rise', 'social_pulse'
  )),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  city text NOT NULL,
  fired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '6 minutes'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  claimed_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_events_city_fired
  ON public.live_events (city, fired_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_events_expires
  ON public.live_events (expires_at);

CREATE INDEX IF NOT EXISTS idx_live_events_venue_type_fired
  ON public.live_events (venue_id, event_type, fired_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_events_fired
  ON public.live_events (fired_at DESC);

ALTER TABLE public.live_events ENABLE ROW LEVEL SECURITY;

-- Public read — events are non-sensitive and the map can be browsed
-- without auth. Writes happen via SECURITY DEFINER fns only; service
-- role bypasses RLS, so no INSERT/UPDATE/DELETE policy needed.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'live_events'
      AND policyname = 'live_events_read_all'
  ) THEN
    CREATE POLICY "live_events_read_all"
      ON public.live_events FOR SELECT USING (true);
  END IF;
END $$;

-- Add to realtime publication so the frontend gets push updates
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'live_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.live_events;
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────
-- detect_and_record_events
--   Called once per venue per fusion cycle. Cheap if no event fires
--   (a few small COUNT queries against indexed predicates).
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.detect_and_record_events(
  p_venue_id uuid,
  p_current_estimate int,
  p_current_state_label text,
  p_prior_estimate int,
  p_capacity_pct numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

GRANT EXECUTE ON FUNCTION public.detect_and_record_events(uuid, int, text, int, numeric)
  TO service_role;

-- ───────────────────────────────────────────────────────────────
-- compute_venue_estimate — replace in-place, append PERFORM call
-- right before the final RETURN QUERY (after STEP 8 trend block).
-- Body is identical to 00017 with the single PERFORM line added.
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
      SELECT COUNT(*) INTO v_no_data_check
      FROM public.headcount_signals
      WHERE venue_id = p_venue_id
        AND recorded_at > now() - interval '90 minutes'
        AND expires_at > now();

      IF v_no_data_check = 0 THEN
        RETURN QUERY SELECT
          0::int,
          0::int,
          0::int,
          5::int,
          NULL::numeric,
          'Unknown'::text,
          NULL::text,
          0::int,
          0::int,
          false,
          NULL::timestamptz,
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

  -- ── EVENT DETECTION (00019) ──
  -- Fire after the trend computation so prior_estimate is the row that
  -- existed *before* this fusion cycle's UPSERT lands. Errors here
  -- bubble up to the caller; we want them visible in fusion logs.
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
-- clean_expired_events — pg_cron sweeper
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.clean_expired_events()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

GRANT EXECUTE ON FUNCTION public.clean_expired_events() TO service_role;

-- ───────────────────────────────────────────────────────────────
-- Schedule cleanup-events cron every 10 minutes (idempotent)
-- ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-events') THEN
    PERFORM cron.unschedule('cleanup-events');
  END IF;
END $$;

SELECT cron.schedule('cleanup-events', '*/10 * * * *', $cmd$
  SELECT public.clean_expired_events();
$cmd$);

-- ───────────────────────────────────────────────────────────────
-- Verify
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  table_ok boolean;
  pub_ok boolean;
  fn_ok boolean;
  job_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'live_events'
  ) INTO table_ok;

  SELECT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'live_events'
  ) INTO pub_ok;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'detect_and_record_events'
  ) INTO fn_ok;

  SELECT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'cleanup-events'
  ) INTO job_ok;

  RAISE NOTICE '═══ Migration 00019 complete ═══';
  RAISE NOTICE '  live_events table:                 %', CASE WHEN table_ok THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  realtime publication includes it:  %', CASE WHEN pub_ok   THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  detect_and_record_events fn:       %', CASE WHEN fn_ok    THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  cleanup-events cron (every 10m):   %', CASE WHEN job_ok   THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  compute_venue_estimate now PERFORM detect_and_record_events at end of STEP 8';
  RAISE NOTICE '';
  RAISE NOTICE 'Force a surge_rapid_rise for testing:';
  RAISE NOTICE '  -- bump a venue then wait one fusion tick';
  RAISE NOTICE '  -- (the next compute_venue_estimate call will see prior=N, current=200)';
END $$;

COMMIT;
