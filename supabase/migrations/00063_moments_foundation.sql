-- 00063_moments_foundation.sql
-- Clean-slate foundation for venuu's "Moments" feature.
-- Wipes existing recap data, drops stars, rebuilds venue_recaps
-- as a pure photo-moments table with strict once-per-venue-per-user.
--
-- Handles dependent views (user_account_stats, public_profile_view)
-- by dropping and recreating them around the stars column drop.
-- Recreated views NO LONGER reference stars — taste_accuracy_pct
-- defaults to 0 in the view; the client's hook computes it from
-- user_taste_ratings instead.

BEGIN;

-- ─── 0. Drop dependent views FIRST ────────────────────────────
-- These will be recreated at the bottom of this migration without
-- referencing the stars column. CASCADE handles nested deps.
DROP VIEW IF EXISTS public.public_profile_view CASCADE;
DROP VIEW IF EXISTS public.user_account_stats CASCADE;

-- ─── 1. Wipe legacy recap data ────────────────────────────────
TRUNCATE TABLE public.venue_recaps;

-- ─── 2. Drop the stars column ─────────────────────────────────
ALTER TABLE public.venue_recaps
  DROP COLUMN IF EXISTS stars;

-- body becomes optional (photos are the moment, body is caption).
ALTER TABLE public.venue_recaps
  ALTER COLUMN body DROP NOT NULL,
  ALTER COLUMN body SET DEFAULT '';

-- ─── 3. Add moments columns ───────────────────────────────────
ALTER TABLE public.venue_recaps
  ADD COLUMN IF NOT EXISTS photo_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS hue_at_capture integer NOT NULL DEFAULT 0
    CHECK (hue_at_capture >= 0 AND hue_at_capture <= 360),
  ADD COLUMN IF NOT EXISTS developed_at timestamptz NOT NULL DEFAULT (
    ((date_trunc('day', (now() AT TIME ZONE 'America/New_York'))
      + INTERVAL '1 day'
      + INTERVAL '8 hours'
    ) AT TIME ZONE 'America/New_York')
  ),
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Drop the default on photo_url — every future insert MUST supply one.
ALTER TABLE public.venue_recaps
  ALTER COLUMN photo_url DROP DEFAULT;

COMMENT ON COLUMN public.venue_recaps.photo_url IS
  'Required. Supabase Storage URL for the captured moment photo.';
COMMENT ON COLUMN public.venue_recaps.hue_at_capture IS
  'Venue current_hue (0-360) at capture time. The paint colors your photo frame forever.';
COMMENT ON COLUMN public.venue_recaps.developed_at IS
  'Default: next 8am ET after creation. Photo private to author until this passes.';
COMMENT ON COLUMN public.venue_recaps.user_id IS
  'Auth user id at insert. ON DELETE CASCADE removes the moment if account is deleted.';

-- ─── 4. Strict UNIQUE: once per venue per user, lifetime ─────
CREATE UNIQUE INDEX IF NOT EXISTS moments_unique_per_venue
  ON public.venue_recaps (venue_id, username);

-- ─── 5. RLS — replace old policies ───────────────────────────
DROP POLICY IF EXISTS "read_vr" ON public.venue_recaps;
DROP POLICY IF EXISTS "insert_vr_authed" ON public.venue_recaps;

CREATE POLICY "read_developed_moments"
  ON public.venue_recaps FOR SELECT TO public
  USING (developed_at <= now());

CREATE POLICY "read_own_developing"
  ON public.venue_recaps FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "update_own_moment"
  ON public.venue_recaps FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "delete_own_moment"
  ON public.venue_recaps FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ─── 6. Storage bucket: recap-moments ─────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'recap-moments', 'recap-moments', true, 5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
  )
  ON CONFLICT (id) DO NOTHING;

-- Drop existing recap_moments policies if they exist (idempotency)
DROP POLICY IF EXISTS "recap_moments_public_read" ON storage.objects;
DROP POLICY IF EXISTS "recap_moments_authed_insert" ON storage.objects;
DROP POLICY IF EXISTS "recap_moments_authed_delete_own" ON storage.objects;

CREATE POLICY "recap_moments_public_read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'recap-moments');

CREATE POLICY "recap_moments_authed_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'recap-moments');

CREATE POLICY "recap_moments_authed_delete_own"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'recap-moments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ─── 7. submit_moment RPC ─────────────────────────────────────
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

  INSERT INTO public.venue_recaps (
    venue_id, username, body, day_of,
    photo_url, hue_at_capture, user_id
  )
  VALUES (
    p_venue_id, p_username, '', CURRENT_DATE,
    p_photo_url, p_hue_at_capture, v_user_id
  )
  RETURNING * INTO v_inserted;

  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_moment(uuid, text, text, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_moment(uuid, text, text, integer) FROM anon;

COMMENT ON FUNCTION public.submit_moment IS
  'Atomic gate-checked moment insert. Auth + Guest-block + once-per-venue.';

-- ─── 8. RECREATE user_account_stats WITHOUT stars ────────────
-- Same signature as before, but taste_accuracy_pct hard-coded to 0.
-- The client hook (useUserAccountStats.ts) already has a fallback
-- that computes the real value from user_taste_ratings when the
-- view returns 0, so no client code changes.
-- total_recaps now counts moments (semantically: "moments captured").
CREATE VIEW public.user_account_stats AS
SELECT id AS profile_id,
    auth_id,
    username,
    COALESCE(( SELECT count(DISTINCT uv.night_of) AS count
           FROM user_visits uv
          WHERE uv.user_id = p.id), 0::bigint)::integer AS nights_out,
    COALESCE(( SELECT count(DISTINCT uv.venue_id) AS count
           FROM user_visits uv
          WHERE uv.user_id = p.id), 0::bigint)::integer AS venues_discovered,
    COALESCE(( SELECT count(*) AS count
           FROM venue_recaps
          WHERE venue_recaps.username::text = p.username::text), 0::bigint)::integer AS total_recaps,
    0 AS taste_accuracy_pct,
    COALESCE(( SELECT count(*) AS count
           FROM night_plans
          WHERE night_plans.user_id = p.id), 0::bigint)::integer AS total_plans,
    COALESCE(( SELECT count(*) AS count
           FROM night_plans
          WHERE night_plans.user_id = p.id AND night_plans.status = 'completed'::text), 0::bigint)::integer AS plans_completed,
    COALESCE(( SELECT count(*) AS count
           FROM loyalty_redemptions
          WHERE loyalty_redemptions.user_id = p.auth_id), 0::bigint)::integer AS total_rewards,
    COALESCE(( SELECT count(DISTINCT loyalty_visits.venue_id) AS count
           FROM loyalty_visits
          WHERE loyalty_visits.user_id = p.auth_id), 0::bigint)::integer AS loyalty_bars_count
   FROM profiles p;

-- Restore grant lost by DROP VIEW (originally granted in 00030).
GRANT SELECT ON public.user_account_stats TO authenticated;

-- ─── 9. RECREATE public_profile_view ─────────────────────────
-- Same signature, references the new user_account_stats above.
CREATE VIEW public.public_profile_view AS
SELECT p.profile_share_token,
    p.username,
    p.display_name,
    p.bio,
    p.tagline,
    p.avatar_color,
    p.city AS home_city,
    p.created_at AS member_since,
    COALESCE(uas.nights_out, 0) AS nights_out,
    COALESCE(uas.venues_discovered, 0) AS venues_discovered,
    COALESCE(uas.total_recaps, 0) AS total_recaps,
    COALESCE(uas.taste_accuracy_pct, 0) AS taste_accuracy_pct,
    COALESCE(uas.plans_completed, 0) AS plans_completed
   FROM profiles p
     LEFT JOIN user_account_stats uas ON uas.profile_id = p.id
  WHERE p.show_recaps_publicly = true OR p.show_visits_publicly = true;

-- Restore grant lost by DROP VIEW (originally granted in 00031).
GRANT SELECT ON public.public_profile_view TO anon, authenticated;

COMMIT;
