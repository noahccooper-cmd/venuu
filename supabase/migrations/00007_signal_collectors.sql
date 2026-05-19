-- ═══════════════════════════════════════════════════════════════
-- 00007_signal_collectors.sql
-- record_signal helper + extends existing RPCs to write signals server-side.
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- record_signal: the canonical signal-write helper
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_signal(
  p_venue_id uuid,
  p_user_id uuid,
  p_signal_type text,
  p_signal_value numeric DEFAULT 1.0,
  p_source_table text DEFAULT NULL,
  p_source_row_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

  -- Dedup: if source_table + source_row_id already exist, skip.
  IF p_source_table IS NOT NULL AND p_source_row_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.headcount_signals
      WHERE source_table = p_source_table AND source_row_id = p_source_row_id
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

GRANT EXECUTE ON FUNCTION public.record_signal(
  uuid, uuid, text, numeric, text, uuid, jsonb
) TO authenticated, anon;

-- ───────────────────────────────────────────────────────────────
-- Extend record_venue_checkin to write loyalty_visit signal
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_venue_checkin(
  p_user_id uuid,
  p_venue_id uuid,
  p_source text,
  p_user_lat numeric,
  p_user_lng numeric,
  p_device_id text,
  p_nfc_password text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
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
$function$;

-- ───────────────────────────────────────────────────────────────
-- Extend increment_headcount to write bouncer_headcount signal
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_headcount(
  target_venue uuid,
  target_city character varying,
  target_night date,
  staff_user uuid DEFAULT NULL::uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

-- ───────────────────────────────────────────────────────────────
-- Extend decrement_headcount to write bouncer_headcount signal
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decrement_headcount(
  target_venue uuid,
  target_city character varying,
  target_night date,
  staff_user uuid DEFAULT NULL::uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

-- ───────────────────────────────────────────────────────────────
-- Extend adjust_headcount to write bouncer_headcount signal
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.adjust_headcount(
  target_venue uuid,
  target_city character varying,
  target_night date,
  adjustment integer,
  staff_user uuid DEFAULT NULL::uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
