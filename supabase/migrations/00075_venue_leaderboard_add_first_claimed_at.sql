-- ═══════════════════════════════════════════════════════════════
-- 00075_venue_leaderboard_add_first_claimed_at.sql
--
-- DRAFT — adds venue_leaderboard.first_claimed_at, the earliest
-- user_visits.first_seen_at for a (profile_id, venue_id) pair.
--
-- WHY: the Community tab's bar-ownership UI (useBarOwnership.ts)
-- needs a deterministic tiebreaker when multiple users are tied at
-- venue_rank = 1 (same venue_score) — the earliest claimant should
-- win, not whatever order Postgres/PostgREST happens to return ties
-- in. That data (user_visits.first_seen_at) can't be read directly
-- from the client: user_visits RLS is `TO authenticated USING
-- (auth.uid() = own profile's auth_id)` — a user can only see their
-- own rows, so a client-side query for OTHER tied users' first_seen_at
-- silently returns [] under RLS. Confirmed live before drafting this:
-- an anon-key GET against user_visits for a real venue returned [].
--
-- The existing pattern for this exact problem is what venue_leaderboard
-- already does for visit_count/distinct_nights/total_minutes — expose
-- an aggregate through the view (which runs under the view owner's
-- privileges, bypassing per-row RLS), never expose raw user_visits
-- rows to the client. This migration extends that same aggregation
-- with one more column, MIN(first_seen_at), instead of adding a new
-- read path into the base table.
--
-- ADDITIVE ONLY — CREATE OR REPLACE VIEW is legal here:
--   • visit_agg CTE gains one new aggregate: min(first_seen_at)
--   • scored CTE threads it through unchanged
--   • final SELECT appends it as the LAST column (after venue_rank),
--     which is what Postgres requires for CREATE OR REPLACE VIEW to
--     accept a changed column list — no drop, no reorder, no type
--     change on any existing column
-- Grants are re-issued for clarity/consistency with prior migrations
-- in this chain, even though CREATE OR REPLACE VIEW (unlike DROP+
-- CREATE) does not actually wipe existing grants.
--
-- DRAFT ONLY. Not applied. Review before running `supabase db push`.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE VIEW public.venue_leaderboard AS
WITH visit_agg AS (
  SELECT user_visits.user_id AS profile_id,
     user_visits.venue_id,
     count(*) AS visit_count,
     count(DISTINCT user_visits.night_of) AS distinct_nights,
     COALESCE(sum(user_visits.duration_min), 0::bigint) AS total_minutes,
     min(user_visits.first_seen_at) AS first_claimed_at
    FROM public.user_visits
   GROUP BY user_visits.user_id, user_visits.venue_id
), scored AS (
  SELECT v.profile_id,
     v.venue_id,
     v.visit_count,
     v.distinct_nights,
     v.total_minutes,
     v.first_claimed_at,
     ((v.visit_count * 10 + v.distinct_nights * 15)::numeric + LEAST(v.total_minutes, 600::bigint)::numeric * 0.3)::integer AS venue_score
    FROM visit_agg v
)
SELECT sc.profile_id,
   sc.venue_id,
   ven.name AS venue_name,
   ven.slug AS venue_slug,
   ven.city,
   p.username,
   p.display_name,
   p.avatar_color,
   p.avatar_url,
   sc.visit_count,
   sc.distinct_nights,
   sc.total_minutes,
   sc.venue_score,
   rank() OVER (PARTITION BY sc.venue_id ORDER BY sc.venue_score DESC) AS venue_rank,
   sc.first_claimed_at
  FROM scored sc
    JOIN public.profiles p ON p.id = sc.profile_id
    JOIN public.venues ven ON ven.id = sc.venue_id
 WHERE COALESCE(p.leaderboard_excluded, false) = false
   AND COALESCE(p.is_active, true) = true
   AND sc.venue_score > 0;

GRANT ALL ON TABLE public.venue_leaderboard TO anon;
GRANT ALL ON TABLE public.venue_leaderboard TO authenticated;
GRANT ALL ON TABLE public.venue_leaderboard TO service_role;

DO $$
BEGIN
  RAISE NOTICE '-----------------------------------';
  RAISE NOTICE 'venue_leaderboard: added first_claimed_at = MIN(user_visits.first_seen_at) (00075)';
  RAISE NOTICE '  additive only — appended as last column, all existing columns unchanged';
  RAISE NOTICE '  lets useBarOwnership.ts break venue_rank=1 ties deterministically (earliest claim wins)';
  RAISE NOTICE '  without querying user_visits directly, which RLS blocks for other users rows';
  RAISE NOTICE '-----------------------------------';
END $$;

COMMIT;
