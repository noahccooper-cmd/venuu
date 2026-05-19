-- ═══════════════════════════════════════════════════════════════
-- 00029_profile_identity_v2.sql
--
-- Profile identity upgrade — Ship 1.
-- Adds editable identity fields (bio, tagline, avatar_color), a
-- public share token, two privacy toggles, and a derived stats view
-- that consolidates the dark data the app was already collecting
-- (loyalty_visits, cover_purchases, venue_recaps, night_plans,
-- loyalty_redemptions).
--
-- Wrapped in BEGIN/COMMIT. Idempotent — ADD COLUMN IF NOT EXISTS
-- on existing rows, CREATE OR REPLACE VIEW, and a one-time
-- conditional UPDATE that only touches rows missing the new
-- share_token.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- A) Extend profiles
-- ───────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS tagline TEXT,
  ADD COLUMN IF NOT EXISTS avatar_color TEXT DEFAULT 'orange',
  ADD COLUMN IF NOT EXISTS profile_share_token TEXT,
  ADD COLUMN IF NOT EXISTS show_recaps_publicly BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_visits_publicly BOOLEAN DEFAULT true;

-- Constraints — added in DO blocks so re-running the migration is safe.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_bio_length' AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_bio_length CHECK (bio IS NULL OR char_length(bio) <= 160);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_tagline_length' AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_tagline_length CHECK (tagline IS NULL OR char_length(tagline) <= 50);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_avatar_color_valid' AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_avatar_color_valid
      CHECK (avatar_color IN ('orange','cyan','purple','green','pink','gold','sienna','wine'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_share_token_unique' AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_share_token_unique UNIQUE (profile_share_token);
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────
-- B) Backfill share_token — one-time, only touches NULLs
-- ───────────────────────────────────────────────────────────────

UPDATE public.profiles
   SET profile_share_token = encode(gen_random_bytes(8), 'hex')
 WHERE profile_share_token IS NULL;

-- ───────────────────────────────────────────────────────────────
-- C) Stats view — drives the new hero counters on the profile.
--    Note: loyalty_visits, cover_purchases, loyalty_redemptions
--    all key on auth.users.id (= profiles.auth_id), while
--    night_plans keys on profiles.id (Ship v1.2 schema), and
--    venue_recaps uses denormalized username.
-- ───────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.user_account_stats AS
SELECT
  p.id        AS profile_id,
  p.auth_id   AS auth_id,
  p.username  AS username,
  -- Nights Out: distinct nights with at least one loyalty_visit
  COALESCE((
    SELECT COUNT(DISTINCT night_of)
      FROM public.loyalty_visits lv
     WHERE lv.user_id = p.auth_id
  ), 0)::int AS nights_out,
  -- Venues Discovered: distinct venues touched by check-in OR cover
  COALESCE((
    SELECT COUNT(DISTINCT venue_id) FROM (
      SELECT venue_id FROM public.loyalty_visits   WHERE user_id = p.auth_id
      UNION
      SELECT venue_id FROM public.cover_purchases  WHERE user_id = p.auth_id
    ) v
  ), 0)::int AS venues_discovered,
  -- Total ratings the user has given
  COALESCE((
    SELECT COUNT(*) FROM public.venue_recaps WHERE username = p.username
  ), 0)::int AS total_recaps,
  -- Taste accuracy proxy: % of own recaps rated 4+ stars
  COALESCE((
    SELECT (COUNT(*) FILTER (WHERE stars >= 4)::numeric * 100
            / NULLIF(COUNT(*), 0))::int
      FROM public.venue_recaps WHERE username = p.username
  ), 0)::int AS taste_accuracy_pct,
  -- Plans
  COALESCE((
    SELECT COUNT(*) FROM public.night_plans WHERE user_id = p.id
  ), 0)::int AS total_plans,
  COALESCE((
    SELECT COUNT(*) FROM public.night_plans
     WHERE user_id = p.id AND status = 'completed'
  ), 0)::int AS plans_completed,
  -- Total loyalty rewards earned
  COALESCE((
    SELECT COUNT(*) FROM public.loyalty_redemptions WHERE user_id = p.auth_id
  ), 0)::int AS total_rewards
FROM public.profiles p;

-- ───────────────────────────────────────────────────────────────
-- D) Grants
-- ───────────────────────────────────────────────────────────────

GRANT SELECT ON public.user_account_stats TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- E) RLS — profiles already has "update_profiles_self" (00001) which
--    is column-agnostic (USING / WITH CHECK on auth_id = auth.uid()).
--    The new columns inherit owner-write automatically.
--    Nothing more needed here; left for documentation.
-- ───────────────────────────────────────────────────────────────

-- ───────────────────────────────────────────────────────────────
-- Verify
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  has_bio          boolean;
  has_tagline      boolean;
  has_avatar_color boolean;
  has_share_token  boolean;
  has_show_recaps  boolean;
  has_show_visits  boolean;
  view_exists      boolean;
  backfilled       int;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles' AND column_name='bio'
  ) INTO has_bio;
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles' AND column_name='tagline'
  ) INTO has_tagline;
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles' AND column_name='avatar_color'
  ) INTO has_avatar_color;
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles' AND column_name='profile_share_token'
  ) INTO has_share_token;
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles' AND column_name='show_recaps_publicly'
  ) INTO has_show_recaps;
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles' AND column_name='show_visits_publicly'
  ) INTO has_show_visits;
  SELECT EXISTS(
    SELECT 1 FROM information_schema.views
     WHERE table_schema='public' AND table_name='user_account_stats'
  ) INTO view_exists;
  SELECT COUNT(*) FROM public.profiles
    WHERE profile_share_token IS NOT NULL
    INTO backfilled;

  RAISE NOTICE '═══ Migration 00029 complete ═══';
  RAISE NOTICE '  profiles.bio:                  %', CASE WHEN has_bio          THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  profiles.tagline:              %', CASE WHEN has_tagline      THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  profiles.avatar_color:         %', CASE WHEN has_avatar_color THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  profiles.profile_share_token:  %', CASE WHEN has_share_token  THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  profiles.show_recaps_publicly: %', CASE WHEN has_show_recaps  THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  profiles.show_visits_publicly: %', CASE WHEN has_show_visits  THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  user_account_stats view:       %', CASE WHEN view_exists      THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  profiles with share_token:     %', backfilled;
END $$;

COMMIT;
