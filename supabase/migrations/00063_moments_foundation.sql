-- 00063_moments_foundation.sql
-- Clean-slate foundation for venuu's "Moments" feature.
-- Wipes existing recap data (182 legacy rows including ~150
-- Guest-username duplicates from a pre-PROMPT-40 bug), drops the
-- stars column entirely, and rebuilds venue_recaps as a pure
-- photo-moments table with strict once-per-venue-per-user enforcement.
--
-- After this migration:
--   - One row per (venue_id, username) — lifetime
--   - Every row carries photo_url + hue_at_capture + developed_at
--   - Photo develops at next 8am ET after creation
--   - Submitted only via submit_moment RPC (Guest blocked)

BEGIN;

-- ─── 1. Wipe legacy data ──────────────────────────────────────
-- All 182 existing rows are tossed. They're a mix of Guest
-- duplicates and pre-stars-removal text recaps that have no place
-- in the new architecture.
TRUNCATE TABLE public.venue_recaps;

-- ─── 2. Drop legacy columns ───────────────────────────────────
ALTER TABLE public.venue_recaps
  DROP COLUMN IF EXISTS stars;

-- body becomes optional — moments are the photo, body is just an
-- optional caption. Default to empty string for backwards compat
-- with any code still sending body.
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

-- After columns are added with defaults applied to populate any
-- (impossible, since we just truncated) existing rows, drop the
-- defaults on photo_url — every future insert MUST supply one.
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
-- Not partial, not scoped. Every row is a photo-moment now.
-- (venue_id, username) is the canonical pair. user_id is the
-- future-proof identifier but username is what we constrain on
-- today because all existing client code uses username.
CREATE UNIQUE INDEX IF NOT EXISTS moments_unique_per_venue
  ON public.venue_recaps (venue_id, username);

-- ─── 5. RLS — replace the old read_vr policy ─────────────────
DROP POLICY IF EXISTS "read_vr" ON public.venue_recaps;
DROP POLICY IF EXISTS "insert_vr_authed" ON public.venue_recaps;

-- Public can SELECT only developed moments (8am ET next-morning
-- has passed). Author sees their own developing moments too.
CREATE POLICY "read_developed_moments"
  ON public.venue_recaps FOR SELECT TO public
  USING (developed_at <= now());

CREATE POLICY "read_own_developing"
  ON public.venue_recaps FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- INSERT only via submit_moment RPC — direct .insert() from clients
-- is blocked. This forces all writes through the gated function.
-- We do NOT recreate the broad insert_vr_authed policy.

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
    'recap-moments',
    'recap-moments',
    true,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
  )
  ON CONFLICT (id) DO NOTHING;

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
-- The ONLY way to insert into venue_recaps. Gates: auth required,
-- Guest blocked, once-per-venue enforced. Atomic — either the row
-- lands cleanly or a structured error is raised.

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
  -- Auth check
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  -- Guest block. Moments are attributed by design.
  IF p_username IS NULL OR p_username = '' OR LOWER(p_username) = 'guest' THEN
    RAISE EXCEPTION 'guest_not_allowed' USING ERRCODE = 'P0001';
  END IF;

  -- Photo URL required
  IF p_photo_url IS NULL OR p_photo_url = '' THEN
    RAISE EXCEPTION 'photo_required' USING ERRCODE = 'P0001';
  END IF;

  -- Hue bounds (mirrors the column CHECK, but with a cleaner error)
  IF p_hue_at_capture < 0 OR p_hue_at_capture > 360 THEN
    RAISE EXCEPTION 'invalid_hue' USING ERRCODE = 'P0001';
  END IF;

  -- Once-per-venue check (early-exit before insert)
  IF EXISTS (
    SELECT 1 FROM public.venue_recaps
    WHERE venue_id = p_venue_id
      AND username = p_username
  ) THEN
    RAISE EXCEPTION 'already_crowned' USING ERRCODE = 'P0001';
  END IF;

  -- Insert. developed_at uses the column default (next 8am ET).
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
  'Atomic gate-checked moment insert. Auth + Guest-block + once-per-venue. Raises structured errors.';

COMMIT;
