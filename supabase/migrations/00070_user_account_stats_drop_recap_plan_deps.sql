-- ═══════════════════════════════════════════════════════════════
-- 00070_user_account_stats_drop_recap_plan_deps.sql
--
-- DRAFT — Step (a) of the venue_recaps/night_plans retirement chain.
-- Must apply BEFORE 00072 (leaderboard views) and BEFORE the table
-- drops (00073/00074), since user_venuu_rank sources total_recaps
-- and plans_completed FROM this view, and this view is the thing
-- actually touching venue_recaps/night_plans directly.
--
-- user_account_stats currently computes two columns via live
-- subqueries against tables slated for removal:
--
--   total_recaps      <- count(*) FROM venue_recaps WHERE username = ...
--   total_plans        <- count(*) FROM night_plans WHERE user_id = ...
--   plans_completed    <- count(*) FROM night_plans WHERE user_id = ... AND status = 'completed'
--
-- CHOICE MADE: keep the columns, source them as literal 0 — do NOT
-- drop them from the view's output. Two reasons:
--
--   1. public_profile_view (public share page) selects total_recaps
--      and plans_completed FROM this view via a LEFT JOIN. Zeroing
--      here means 00071 (public_profile_view) doesn't strictly need
--      to touch its own column list — it just inherits zeros.
--   2. src/pages/PublicProfilePage.tsx (still-live app code) declares
--      both fields as `number` (not optional) in its TS interface and
--      renders `plans_completed` conditionally (`{plans_completed > 0
--      && (...)}`). Dropping the columns would return rows missing
--      those keys — a silent type-safety violation and an app-code
--      change nobody asked for in this pass. Zeroing needs no
--      frontend change: the "plans completed" block just stops
--      rendering (condition permanently false), exactly the right
--      behavior once no plan can ever complete again. `total_recaps`
--      is declared but was already unused in that component's render
--      — confirmed via grep before drafting this.
--
-- Column set, order, and types are all unchanged, so CREATE OR
-- REPLACE VIEW is legal here (no DROP+CREATE needed).
--
-- DRAFT ONLY. Not applied.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE VIEW public.user_account_stats AS
 SELECT id AS profile_id,
    auth_id,
    username,
    (COALESCE(( SELECT count(DISTINCT uv.night_of) AS count
           FROM public.user_visits uv
          WHERE (uv.user_id = p.id)), (0)::bigint))::integer AS nights_out,
    (COALESCE(( SELECT count(DISTINCT uv.venue_id) AS count
           FROM public.user_visits uv
          WHERE (uv.user_id = p.id)), (0)::bigint))::integer AS venues_discovered,
    -- total_recaps: was `count(*) FROM venue_recaps WHERE username = p.username`.
    -- venue_recaps is being dropped; recaps can never grow again — 0, always.
    0 AS total_recaps,
    0 AS taste_accuracy_pct,
    -- total_plans / plans_completed: were both `count(*) FROM night_plans ...`.
    -- night_plans is being dropped; plans can never grow again — 0, always.
    0 AS total_plans,
    0 AS plans_completed,
    (COALESCE(( SELECT count(*) AS count
           FROM public.loyalty_redemptions
          WHERE (loyalty_redemptions.user_id = p.auth_id)), (0)::bigint))::integer AS total_rewards,
    (COALESCE(( SELECT count(DISTINCT loyalty_visits.venue_id) AS count
           FROM public.loyalty_visits
          WHERE (loyalty_visits.user_id = p.auth_id)), (0)::bigint))::integer AS loyalty_bars_count
   FROM public.profiles p;

DO $$
BEGIN
  RAISE NOTICE '-----------------------------------';
  RAISE NOTICE 'user_account_stats: total_recaps/total_plans/plans_completed now hardcoded 0 (00070)';
  RAISE NOTICE '  no longer queries venue_recaps or night_plans — safe ahead of their drop';
  RAISE NOTICE '  columns preserved (not dropped) — public_profile_view + PublicProfilePage.tsx need no changes';
  RAISE NOTICE '  nights_out, venues_discovered, total_rewards, loyalty_bars_count: unchanged';
  RAISE NOTICE '-----------------------------------';
END $$;

COMMIT;
