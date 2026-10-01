-- ═══════════════════════════════════════════════════════════════════
-- 00079_profiles_privacy.sql — close the profiles leak (run after 00077).
--
-- Before: emergency_read_profiles (USING true) let anyone — signed out
-- included — read every profile column: email, auth_id, class_year, bio,
-- flags. Two leaderboard views also handed auth_id to anon.
--
-- Approach: row-level, not column-level.
--   • profiles (base table): readable only by the row's owner and admins.
--   • public_profiles (new view): the public columns other users may see —
--     id, username, display_name, avatar_url, avatar_color, home_city.
--   • Leaderboard/public-profile views keep working unchanged: they run as
--     their owner and never exposed email; user_account_stats.auth_id is
--     masked to owner/admin/server (user_venuu_rank inherits the mask).
--
-- Why not column-level GRANT/REVOKE: 7 existing RLS policies on 4 other
-- tables (user_visits ×3, presence_events ×2, paint_prompts,
-- profile_share_views) — plus 00077's 2 RSVP policies — look up
-- profiles.auth_id inside the policy; revoking that column would make all
-- of them fail with "permission denied". It would also break useAuth's select('*') in every build already
-- installed on phones. Row-level keeps both working — each of those lookups
-- only ever needs the caller's own row.
--
-- Client changes needed (3 queries): username availability (OnboardScreen,
-- NicknameScreen) → public_profiles; share-link view log (PublicProfilePage)
-- → profile_id_for_share_token(). Older builds degrade safely: username
-- uniqueness is still enforced by profiles_username_key, and the share-view
-- log is best-effort.
--
-- Idempotent. Wrapped in BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────────
-- Guard: only redefine user_account_stats if it is exactly the definition
-- this migration was validated against (00070), or already this one.
-- ───────────────────────────────────────────────────────────────────
DO $$
DECLARE h text := md5(pg_get_viewdef('public.user_account_stats'::regclass, true));
BEGIN
  IF h NOT IN ('7d220bafb9a14d7f3e6f524ed2c6b0ff', 'ab280fa49e8d5554fa8bf1a0bfd7b0f4') THEN
    RAISE EXCEPTION 'user_account_stats differs from the validated definition (md5 %). Diff it before applying 00079.', h;
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────
-- 1. profiles: owner + admin only
-- ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "emergency_read_profiles" ON public.profiles;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'
                 AND policyname = 'profiles_read_own') THEN
    CREATE POLICY profiles_read_own ON public.profiles
      FOR SELECT TO authenticated
      USING (auth_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'
                 AND policyname = 'profiles_read_admin') THEN
    CREATE POLICY profiles_read_admin ON public.profiles
      FOR SELECT TO authenticated
      USING (public.has_role(ARRAY['admin']));
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────
-- 2. public_profiles: what other users may see
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.public_profiles AS
  SELECT id, username, display_name, avatar_url, avatar_color, city AS home_city
  FROM public.profiles;

GRANT SELECT ON public.public_profiles TO anon, authenticated, service_role;

-- Share links: token → profile id, without exposing tokens in a listable view.
CREATE OR REPLACE FUNCTION public.profile_id_for_share_token(p_token text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM public.profiles WHERE profile_share_token = p_token LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.profile_id_for_share_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.profile_id_for_share_token(text) TO anon, authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────
-- 3. user_account_stats: auth_id only for its owner, admins, and the
--    server (SQL editor / service_role). Same columns, same types, same
--    body as 00070 otherwise — so CREATE OR REPLACE is legal and
--    user_venuu_rank / public_profile_view need no change.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.user_account_stats AS
 SELECT id AS profile_id,
    CASE
      WHEN NOT public.is_app_request() OR auth_id = auth.uid() OR public.has_role(ARRAY['admin'])
      THEN auth_id
    END AS auth_id,
    username,
    (COALESCE(( SELECT count(DISTINCT uv.night_of) AS count
           FROM public.user_visits uv
          WHERE (uv.user_id = p.id)), (0)::bigint))::integer AS nights_out,
    (COALESCE(( SELECT count(DISTINCT uv.venue_id) AS count
           FROM public.user_visits uv
          WHERE (uv.user_id = p.id)), (0)::bigint))::integer AS venues_discovered,
    0 AS total_recaps,
    0 AS taste_accuracy_pct,
    0 AS total_plans,
    0 AS plans_completed,
    (COALESCE(( SELECT count(*) AS count
           FROM public.loyalty_redemptions
          WHERE (loyalty_redemptions.user_id = p.auth_id)), (0)::bigint))::integer AS total_rewards,
    (COALESCE(( SELECT count(DISTINCT loyalty_visits.venue_id) AS count
           FROM public.loyalty_visits
          WHERE (loyalty_visits.user_id = p.auth_id)), (0)::bigint))::integer AS loyalty_bars_count
   FROM public.profiles p;

COMMIT;
