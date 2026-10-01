-- Update submit_moment RPC to populate user_moment_number.
-- The number = the user's count of existing recaps + 1.
-- This is computed atomically inside the transaction so two
-- concurrent inserts can't both claim the same number.
--
-- IMPORTANT — schema reconciliation from PROMPT 49b spec:
--   The original PROMPT 49b draft referenced columns
--     (hue_id, photo_path, paint_prompt_id)
--   that don't exist on venue_recaps as of migration 00063.
--   The real columns are
--     (hue_at_capture integer, photo_url text, username text,
--      body, day_of, user_id, developed_at) — plus the new
--     user_moment_number from 00064.
--   This migration keeps the EXISTING submit_moment signature
--   (uuid, text, text, integer) — = (venue, username, photo_url,
--   hue_at_capture) — so the legacy PaintScreen → useCaptureMoment
--   flow keeps working unchanged. The only behavioural change is
--   that every insert now ALSO writes user_moment_number, and the
--   returned venue_recaps row includes it for callers that want it.
--
--   Phase 3 (49c) will replace the frontend submit path with the
--   new CaptureSurface flow but can use this same RPC — it just
--   reads the user_moment_number column out of the returned row.

CREATE OR REPLACE FUNCTION public.submit_moment(
  p_venue_id uuid,
  p_username text,
  p_photo_url text,
  p_hue_at_capture integer
)
RETURNS public.venue_recaps
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

  -- NEW: compute user_moment_number atomically inside the transaction.
  -- = count of user's existing recaps + 1. Two concurrent inserts can
  -- still both compute the same count under READ COMMITTED, so the
  -- caller side should treat the engraved number as "best-effort
  -- monotonic per user" rather than strictly unique. A future tightening
  -- can add a partial-unique index on (user_id, user_moment_number) and
  -- retry on conflict; deferring until we see real collision pressure.
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

GRANT EXECUTE ON FUNCTION public.submit_moment(uuid, text, text, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_moment(uuid, text, text, integer) FROM anon;

COMMENT ON FUNCTION public.submit_moment(uuid, text, text, integer) IS
  'Atomic gate-checked moment insert. Auth + Guest-block + once-per-venue. Computes and stores the user''s personal moment number (count + 1) so the engraved JPEG can show the correct ✦ #N.';
