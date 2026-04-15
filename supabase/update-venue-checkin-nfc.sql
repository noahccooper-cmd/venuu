DROP FUNCTION IF EXISTS public.record_venue_checkin(uuid, uuid, text, numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.record_venue_checkin(
  p_user_id uuid,
  p_venue_id uuid,
  p_source text,
  p_user_lat numeric,
  p_user_lng numeric,
  p_device_id text,
  p_nfc_password text DEFAULT NULL
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
  distance_meters numeric;
  already_checked_in boolean;
  recent_checkins integer;
  new_visit_count integer;
  tonight_date date;
BEGIN
  tonight_date := CASE WHEN EXTRACT(HOUR FROM NOW()) < 5
                       THEN (NOW() - INTERVAL '1 day')::date
                       ELSE NOW()::date END;

  SELECT lat, lng, loyalty_active, nfc_password
  INTO venue_lat, venue_lng, venue_loyalty_active, venue_nfc_password
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

  IF distance_meters > 150 THEN
    RETURN json_build_object('success', false, 'error', 'too_far_from_venue');
  END IF;

  SELECT COUNT(*) INTO recent_checkins
  FROM loyalty_visits
  WHERE user_id = p_user_id
    AND visited_at > NOW() - INTERVAL '10 minutes';

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

  INSERT INTO loyalty_visits (user_id, venue_id, source, night_of, visited_at, device_id)
  VALUES (p_user_id, p_venue_id, p_source, tonight_date, NOW(), p_device_id);

  SELECT COUNT(*) INTO new_visit_count
  FROM loyalty_visits
  WHERE user_id = p_user_id AND venue_id = p_venue_id;

  RETURN json_build_object(
    'success', true,
    'visit_count', new_visit_count,
    'distance_meters', distance_meters
  );
END;
$function$;
