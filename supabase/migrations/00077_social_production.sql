-- ═══════════════════════════════════════════════════════════════════
-- 00077_social_production.sql
--
-- Social goes to production: roles, brands, community posting with
-- admin verification, reports/blocks, RLS, realtime, storage, seeds.
-- See docs/social-tab-spec.md.
--
-- Idempotent: every object is guarded (IF NOT EXISTS / pg_* checks /
-- CREATE OR REPLACE); seed rows use fixed ids + ON CONFLICT DO NOTHING,
-- so re-running changes nothing and never overwrites admin edits.
--
-- Enforcement model: RLS policies decide WHO can touch a row; BEFORE
-- triggers enforce posting rules with clear error codes. Triggers only
-- police app requests (JWT role authenticated/anon) — the SQL editor and
-- service_role (seeds, 00078, edge functions) are not restricted.
--
-- Depends on 00076 (events / event_rsvps captured) and the prod schema.
-- Wrapped in BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────────
-- Helpers
-- ───────────────────────────────────────────────────────────────────

-- True for requests coming from the app (PostgREST with a user/anon JWT).
CREATE OR REPLACE FUNCTION public.is_app_request()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(auth.role(), '') IN ('authenticated', 'anon');
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 1. profiles: role, posting_banned, accepted_posting_terms_at
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS posting_banned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accepted_posting_terms_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_role_check'
                 AND conrelid = 'public.profiles'::regclass) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('user', 'host', 'admin'));
  END IF;
END $$;

-- has_role: does the signed-in user hold one of these roles?
CREATE OR REPLACE FUNCTION public.has_role(p_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_id = auth.uid() AND role = ANY (p_roles)
  );
$$;

-- my_profile_id: the signed-in user's profiles.id (≠ auth.uid()).
CREATE OR REPLACE FUNCTION public.my_profile_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM public.profiles WHERE auth_id = auth.uid() LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.has_role(text[]) FROM public;
REVOKE ALL ON FUNCTION public.my_profile_id() FROM public;
GRANT EXECUTE ON FUNCTION public.has_role(text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_profile_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_app_request() TO anon, authenticated, service_role;

-- Users can update their own profile (update_profiles_self), so role and
-- posting_banned must be guarded: only admins (or SQL editor/service_role)
-- may set them. A self-created profile always starts as a plain user.
CREATE OR REPLACE FUNCTION public.guard_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_app_request() OR public.has_role(ARRAY['admin']) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.role := 'user';
    NEW.posting_banned := false;
    RETURN NEW;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.posting_banned IS DISTINCT FROM OLD.posting_banned THEN
    RAISE EXCEPTION 'role_change_forbidden' USING ERRCODE = '42501',
      HINT = 'Only Venuu admins can change roles or posting bans.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_privileges ON public.profiles;
CREATE TRIGGER profiles_guard_privileges
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileges();

-- Admins can update any profile (ban a poster, grant host).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'
                 AND policyname = 'profiles_admin_update') THEN
    CREATE POLICY profiles_admin_update ON public.profiles
      FOR UPDATE TO authenticated
      USING (public.has_role(ARRAY['admin']))
      WITH CHECK (public.has_role(ARRAY['admin']));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 2. brands
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  primary_hex text,
  secondary_hex text,
  accent_hexes jsonb NOT NULL DEFAULT '[]'::jsonb,
  logo_url text,
  product_image_url text,
  tagline text,
  about text,
  website_url text,
  instagram_url text,
  finder_url text,
  email text,
  cities text[] NOT NULL DEFAULT '{}',
  age_gate boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'brands'
                 AND policyname = 'brands_read_active') THEN
    CREATE POLICY brands_read_active ON public.brands
      FOR SELECT TO anon, authenticated
      USING (is_active OR public.has_role(ARRAY['admin']));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'brands'
                 AND policyname = 'brands_admin_write') THEN
    CREATE POLICY brands_admin_write ON public.brands
      FOR ALL TO authenticated
      USING (public.has_role(ARRAY['admin']))
      WITH CHECK (public.has_role(ARRAY['admin']));
  END IF;
END $$;

GRANT SELECT ON TABLE public.brands TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brands TO authenticated;
GRANT ALL ON TABLE public.brands TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 3. events additions
-- ═══════════════════════════════════════════════════════════════════
-- Existing rows default to surface='tonight' (Tonight's own events).
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS surface text NOT NULL DEFAULT 'tonight',
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS series_id uuid,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS host_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verification text NOT NULL DEFAULT 'community',
  ADD COLUMN IF NOT EXISTS date_tba boolean NOT NULL DEFAULT false,
  -- Deny notification: the creator's app shows a one-time notice for each
  -- of their denied events until this is set (no separate table needed).
  ADD COLUMN IF NOT EXISTS denial_seen_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_surface_check'
                 AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_surface_check CHECK (surface IN ('tonight', 'social'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_category_check'
                 AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_category_check
      CHECK (category IS NULL OR category IN ('run_club', 'pop_up', 'nightlife', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_verification_check'
                 AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_verification_check
      CHECK (verification IN ('community', 'verified', 'denied'));
  END IF;
  -- 280-char limit applies to Social posts only, so existing Tonight
  -- descriptions (any length) can't break this migration.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_social_description_len'
                 AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_social_description_len
      CHECK (surface <> 'social' OR description IS NULL OR char_length(description) <= 280);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS events_social_city_start_idx
  ON public.events (city, start_time) WHERE surface = 'social' AND is_active;
CREATE INDEX IF NOT EXISTS events_series_idx ON public.events (series_id) WHERE series_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_host_profile_idx ON public.events (host_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS events_brand_idx ON public.events (brand_id) WHERE brand_id IS NOT NULL;

-- Server-side word filter (the app runs the same list before submit).
-- Whole-word, case-insensitive. Keep in sync with the client list.
CREATE OR REPLACE FUNCTION public.social_text_is_clean(p text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT p IS NULL OR p !~* ('\m(' || array_to_string(ARRAY[
    'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bullshit', 'cunt', 'bitch',
    'nigger', 'nigga', 'faggot', 'fag', 'retard', 'kike', 'spic', 'chink', 'tranny',
    'whore', 'slut', 'rape', 'rapist', 'pedo', 'pedophile'
  ], '|') || ')\M');
$$;

-- Posting rules for app requests on Social rows.
CREATE OR REPLACE FUNCTION public.guard_social_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p public.profiles%ROWTYPE;
  is_admin boolean;
  is_host boolean;
  recent int;
BEGIN
  IF NOT public.is_app_request() THEN
    RETURN NEW;                               -- SQL editor / service_role
  END IF;
  IF TG_OP = 'INSERT' AND NEW.surface IS DISTINCT FROM 'social' THEN
    RETURN NEW;                               -- RLS already limits app inserts to social
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.surface IS DISTINCT FROM 'social' AND NEW.surface IS DISTINCT FROM 'social' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO p FROM public.profiles WHERE auth_id = auth.uid() LIMIT 1;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'profile_required' USING ERRCODE = '42501';
  END IF;
  is_admin := p.role = 'admin';
  is_host := p.role IN ('host', 'admin');

  IF NOT public.social_text_is_clean(NEW.title) OR NOT public.social_text_is_clean(NEW.description) THEN
    RAISE EXCEPTION 'objectionable_content' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF p.posting_banned THEN
      RAISE EXCEPTION 'posting_banned' USING ERRCODE = '42501';
    END IF;
    IF p.accepted_posting_terms_at IS NULL THEN
      RAISE EXCEPTION 'terms_required' USING ERRCODE = '42501';
    END IF;
    IF NEW.city NOT IN ('knoxville', 'tampa', 'st_petersburg') THEN
      RAISE EXCEPTION 'unsupported_city' USING ERRCODE = '22023';
    END IF;
    IF NOT is_host THEN
      IF NEW.date_tba THEN
        RAISE EXCEPTION 'date_tba_hosts_only' USING ERRCODE = '42501';
      END IF;
      IF NEW.brand_id IS NOT NULL OR NEW.series_id IS NOT NULL THEN
        RAISE EXCEPTION 'partner_fields_hosts_only' USING ERRCODE = '42501';
      END IF;
      SELECT count(*) INTO recent FROM public.events
        WHERE host_profile_id = p.id AND surface = 'social' AND created_at > now() - interval '24 hours';
      IF recent >= 3 THEN
        RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000',
          HINT = 'You''ve posted 3 events today — try again tomorrow.';
      END IF;
    END IF;
    -- Server-owned fields.
    NEW.host_profile_id := p.id;
    NEW.created_by := 'profile:' || p.id::text;
    -- Only hosts/admins choose a display host (e.g. a partner name);
    -- everyone else posts as themselves, so no one can pose as a brand.
    IF is_host THEN
      NEW.host_name := coalesce(nullif(NEW.host_name, ''), nullif(p.display_name, ''), p.username, 'Venuu member');
    ELSE
      NEW.host_name := coalesce(nullif(p.display_name, ''), p.username, 'Venuu member');
    END IF;
    NEW.is_active := true;
    NEW.curated := false;
    NEW.marquee := false;
    NEW.denial_seen_at := NULL;
    IF NOT is_admin THEN
      NEW.verification := 'community';
    END IF;
    NEW.event_type := coalesce(NEW.event_type, CASE NEW.category
      WHEN 'run_club' THEN 'fitness'
      WHEN 'pop_up' THEN 'brand'
      WHEN 'nightlife' THEN 'party'
      ELSE 'community' END);
    NEW.expires_at := coalesce(NEW.expires_at, NEW.end_time, NEW.start_time + interval '6 hours');
    RETURN NEW;
  END IF;

  -- UPDATE by owner or admin (RLS decides which rows).
  IF NOT is_admin THEN
    IF NEW.verification IS DISTINCT FROM OLD.verification THEN
      RAISE EXCEPTION 'verification_admins_only' USING ERRCODE = '42501';
    END IF;
    IF NEW.host_profile_id IS DISTINCT FROM OLD.host_profile_id
       OR NEW.surface IS DISTINCT FROM OLD.surface
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.curated IS DISTINCT FROM OLD.curated
       OR NEW.marquee IS DISTINCT FROM OLD.marquee THEN
      RAISE EXCEPTION 'field_locked' USING ERRCODE = '42501';
    END IF;
    IF NOT is_host AND (
         (NEW.date_tba AND NOT OLD.date_tba)
      OR NEW.host_name IS DISTINCT FROM OLD.host_name
      OR NEW.brand_id IS DISTINCT FROM OLD.brand_id
      OR NEW.series_id IS DISTINCT FROM OLD.series_id) THEN
      RAISE EXCEPTION 'partner_fields_hosts_only' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_guard_social ON public.events;
CREATE TRIGGER events_guard_social
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.guard_social_event();

-- ═══════════════════════════════════════════════════════════════════
-- 4. event_reports + user_blocks
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.event_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  reporter_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('spam', 'inappropriate', 'wrong_info', 'other')),
  details text CHECK (details IS NULL OR char_length(details) <= 280),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, reporter_profile_id)
);
CREATE INDEX IF NOT EXISTS event_reports_created_idx ON public.event_reports (created_at DESC);

CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_profile_id, blocked_profile_id),
  CHECK (blocker_profile_id <> blocked_profile_id)
);

ALTER TABLE public.event_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'event_reports'
                 AND policyname = 'event_reports_insert_own') THEN
    CREATE POLICY event_reports_insert_own ON public.event_reports
      FOR INSERT TO authenticated
      WITH CHECK (reporter_profile_id = public.my_profile_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'event_reports'
                 AND policyname = 'event_reports_admin_read') THEN
    CREATE POLICY event_reports_admin_read ON public.event_reports
      FOR SELECT TO authenticated
      USING (public.has_role(ARRAY['admin']));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'event_reports'
                 AND policyname = 'event_reports_admin_delete') THEN
    CREATE POLICY event_reports_admin_delete ON public.event_reports
      FOR DELETE TO authenticated
      USING (public.has_role(ARRAY['admin']));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_blocks'
                 AND policyname = 'user_blocks_own') THEN
    CREATE POLICY user_blocks_own ON public.user_blocks
      FOR ALL TO authenticated
      USING (blocker_profile_id = public.my_profile_id())
      WITH CHECK (blocker_profile_id = public.my_profile_id());
  END IF;
END $$;

GRANT SELECT, INSERT, DELETE ON TABLE public.event_reports TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.user_blocks TO authenticated;
GRANT ALL ON TABLE public.event_reports TO service_role;
GRANT ALL ON TABLE public.user_blocks TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 5. events policies
-- ═══════════════════════════════════════════════════════════════════
-- Tonight check (see report): every Tonight/portal read already filters
-- is_active AND expires_at > now(), or tolerates missing rows.
DROP POLICY IF EXISTS "emergency_read_events" ON public.events;
DROP POLICY IF EXISTS "Authenticated users can create events" ON public.events;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'events'
                 AND policyname = 'events_read_public') THEN
    CREATE POLICY events_read_public ON public.events
      FOR SELECT TO anon, authenticated
      USING (is_active AND verification <> 'denied' AND expires_at > now());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'events'
                 AND policyname = 'events_read_own') THEN
    CREATE POLICY events_read_own ON public.events
      FOR SELECT TO authenticated
      USING (host_profile_id = public.my_profile_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'events'
                 AND policyname = 'events_read_admin') THEN
    CREATE POLICY events_read_admin ON public.events
      FOR SELECT TO authenticated
      USING (public.has_role(ARRAY['admin']));
  END IF;
  -- Signed-in users post to Social only, as themselves. Everything else
  -- (ban, terms, rate limit, host-only fields, verification) is enforced
  -- by guard_social_event.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'events'
                 AND policyname = 'events_insert_social') THEN
    CREATE POLICY events_insert_social ON public.events
      FOR INSERT TO authenticated
      WITH CHECK (surface = 'social' AND host_profile_id = public.my_profile_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'events'
                 AND policyname = 'events_update_owner_admin') THEN
    CREATE POLICY events_update_owner_admin ON public.events
      FOR UPDATE TO authenticated
      USING (host_profile_id = public.my_profile_id() OR public.has_role(ARRAY['admin']))
      WITH CHECK (host_profile_id = public.my_profile_id() OR public.has_role(ARRAY['admin']));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'events'
                 AND policyname = 'events_delete_owner_admin') THEN
    CREATE POLICY events_delete_owner_admin ON public.events
      FOR DELETE TO authenticated
      USING (host_profile_id = public.my_profile_id() OR public.has_role(ARRAY['admin']));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 6. event_rsvps: user_id is profiles.id, not auth.uid()
-- ═══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "rsvps insert own" ON public.event_rsvps;
DROP POLICY IF EXISTS "rsvps delete own" ON public.event_rsvps;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'event_rsvps'
                 AND policyname = 'rsvps_insert_own_profile') THEN
    CREATE POLICY rsvps_insert_own_profile ON public.event_rsvps
      FOR INSERT TO authenticated
      WITH CHECK (user_id IN (SELECT id FROM public.profiles WHERE auth_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'event_rsvps'
                 AND policyname = 'rsvps_delete_own_profile') THEN
    CREATE POLICY rsvps_delete_own_profile ON public.event_rsvps
      FOR DELETE TO authenticated
      USING (user_id IN (SELECT id FROM public.profiles WHERE auth_id = auth.uid()));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 7. Realtime (postgres_changes respects the RLS above)
-- ═══════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 8. Storage buckets
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('brand-assets', 'brand-assets', true, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  ('event-photos', 'event-photos', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/heic'])
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                 AND policyname = 'social_buckets_public_read') THEN
    CREATE POLICY social_buckets_public_read ON storage.objects
      FOR SELECT TO anon, authenticated
      USING (bucket_id IN ('brand-assets', 'event-photos'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                 AND policyname = 'brand_assets_admin_insert') THEN
    CREATE POLICY brand_assets_admin_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'brand-assets' AND public.has_role(ARRAY['admin']));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                 AND policyname = 'brand_assets_admin_modify') THEN
    CREATE POLICY brand_assets_admin_modify ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'brand-assets' AND public.has_role(ARRAY['admin']))
      WITH CHECK (bucket_id = 'brand-assets' AND public.has_role(ARRAY['admin']));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                 AND policyname = 'brand_assets_admin_delete') THEN
    CREATE POLICY brand_assets_admin_delete ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'brand-assets' AND public.has_role(ARRAY['admin']));
  END IF;
  -- Event photos live under <profile id>/<file>.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                 AND policyname = 'event_photos_insert_own_folder') THEN
    CREATE POLICY event_photos_insert_own_folder ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'event-photos' AND (storage.foldername(name))[1] = public.my_profile_id()::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                 AND policyname = 'event_photos_delete_owner_admin') THEN
    CREATE POLICY event_photos_delete_owner_admin ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'event-photos' AND (
        (storage.foldername(name))[1] = public.my_profile_id()::text OR public.has_role(ARRAY['admin'])));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 9. Seed brands (logos/images left null — uploaded to brand-assets later)
-- ═══════════════════════════════════════════════════════════════════
-- Copy note: sun_cruiser.about is draft copy pending Sun Cruiser's approval.
INSERT INTO public.brands
  (slug, name, primary_hex, secondary_hex, accent_hexes, tagline, about,
   website_url, instagram_url, finder_url, email, cities, age_gate, is_active)
VALUES
  ('sun_cruiser', 'Sun Cruiser', '#00A0AF', '#5FD0DF', '["#FFDD00", "#FDB913"]'::jsonb,
   NULL, 'Pop-ups with Venuu across Tampa Bay and Knoxville.',
   'https://www.drinksuncruiser.com', 'https://www.instagram.com/drinksuncruiser',
   'https://www.drinksuncruiser.com/find', NULL,
   ARRAY['tampa', 'st_petersburg', 'knoxville'], true, true),
  ('pinellas_run_club', 'Pinellas Run Club', '#2FBF71', NULL, '[]'::jsonb,
   'The space for your pace.', 'Thursday evenings · Saturday mornings',
   'https://www.pinellasrunclub.com', 'https://www.instagram.com/pinellasrunclub',
   NULL, 'pinellasrunclub@gmail.com',
   ARRAY['st_petersburg'], false, true)
ON CONFLICT (slug) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- 10–11. Seed verified, date-TBA pop-ups
--   start_time is a far-future placeholder used only for sorting (the app
--   shows "Date TBA" whenever date_tba is true); expires_at = +1 year.
--   Fixed ids → re-running inserts nothing new.
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO public.events
  (id, surface, category, event_type, brand_id, verification, date_tba,
   title, host_name, city, latitude, longitude, address,
   start_time, expires_at, created_by, is_active, curated, marquee)
SELECT
  s.id, 'social', 'pop_up', 'brand',
  (SELECT id FROM public.brands WHERE slug = s.brand_slug),
  'verified', true,
  s.title, s.host_name, s.city, s.lat, s.lng, 'Location announced soon',
  now() + interval '11 months', now() + interval '1 year',
  'seed:00077', true, false, false
FROM (VALUES
  -- Sun Cruiser × Venuu — 2 per city (slightly offset so pins don't stack)
  ('5c077000-0000-4000-8000-000000000001'::uuid, 'sun_cruiser', 'Sun Cruiser × Venuu Pop-Up', 'Sun Cruiser', 'tampa',         27.9506, -82.4572),
  ('5c077000-0000-4000-8000-000000000002'::uuid, 'sun_cruiser', 'Sun Cruiser × Venuu Pop-Up', 'Sun Cruiser', 'tampa',         27.9466, -82.4532),
  ('5c077000-0000-4000-8000-000000000003'::uuid, 'sun_cruiser', 'Sun Cruiser × Venuu Pop-Up', 'Sun Cruiser', 'st_petersburg', 27.7706, -82.6398),
  ('5c077000-0000-4000-8000-000000000004'::uuid, 'sun_cruiser', 'Sun Cruiser × Venuu Pop-Up', 'Sun Cruiser', 'st_petersburg', 27.7666, -82.6358),
  ('5c077000-0000-4000-8000-000000000005'::uuid, 'sun_cruiser', 'Sun Cruiser × Venuu Pop-Up', 'Sun Cruiser', 'knoxville',     35.9570, -83.9275),
  ('5c077000-0000-4000-8000-000000000006'::uuid, 'sun_cruiser', 'Sun Cruiser × Venuu Pop-Up', 'Sun Cruiser', 'knoxville',     35.9610, -83.9235),
  -- Venuu pop-ups — Tampa, St. Pete
  ('5c077000-0000-4000-8000-000000000007'::uuid, NULL,          'Venuu Pop-Up',               'Venuu',       'tampa',         27.9546, -82.4612),
  ('5c077000-0000-4000-8000-000000000008'::uuid, NULL,          'Venuu Pop-Up',               'Venuu',       'st_petersburg', 27.7746, -82.6438)
) AS s(id, brand_slug, title, host_name, city, lat, lng)
ON CONFLICT (id) DO NOTHING;

COMMIT;
