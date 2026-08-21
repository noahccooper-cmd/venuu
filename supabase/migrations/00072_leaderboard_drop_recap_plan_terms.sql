-- ═══════════════════════════════════════════════════════════════
-- 00072_leaderboard_drop_recap_plan_terms.sql
--
-- DRAFT — renumbered from 00070. Must apply AFTER 00070
-- (user_account_stats_drop_recap_plan_deps), which resolves the gap
-- flagged below — see that file for why. public_profile_view needs
-- no migration of its own: it only ever read user_account_stats
-- (never venue_recaps/night_plans directly), so 00070 fixes it too.
--
-- Recreates the leaderboard views captured in
-- docs/prod-drift-capture.sql, with two changes:
--
--   1. user_venuu_rank.venuu_score drops the two dead scoring terms
--      (Moments + Plans features were removed from the app in the
--      v3 strip). OLD formula:
--        venues_discovered*100 + total_recaps*60 + nights_out*50
--          + plans_completed*40 + loyalty_bars_count*20
--      NEW formula:
--        venues_discovered*100 + nights_out*50 + loyalty_bars_count*20
--      total_recaps and plans_completed stay as informational columns
--      (still computed from user_account_stats, historically meaningful)
--      — only the SCORE arithmetic changes. Column set/order/types are
--      unchanged, so CREATE OR REPLACE VIEW is legal here.
--
--   2. city_leaderboard and venue_leaderboard both directly query
--      venue_recaps (city_recaps / recap_agg CTEs) to compute
--      recaps_in_city / recap_count. venue_recaps is slated to be
--      DROPPED in a later migration, so these two views must lose
--      their recap CTEs and recap-weighted score terms now, ahead of
--      that drop. This changes their column set (recaps_in_city and
--      recap_count are removed entirely), which CREATE OR REPLACE VIEW
--      does not allow — so these two use DROP VIEW + CREATE VIEW.
--      Confirmed via docs/prod-schema-snapshot.sql that nothing else
--      depends on either view (no other view/function references them).
--
--   OLD city_score: venues_in_city*100 + recaps_in_city*60 + nights_in_city*50 + visits_in_city*10
--   NEW city_score: venues_in_city*100 + nights_in_city*50 + visits_in_city*10
--
--   OLD venue_score: (visit_count*10 + distinct_nights*15 + recap_count*30) + LEAST(total_minutes,600)*0.3
--   NEW venue_score: (visit_count*10 + distinct_nights*15) + LEAST(total_minutes,600)*0.3
--
-- rank_snapshots (table) and snapshot_venuu_ranks() (function) are
-- recreated unchanged, idempotently, since user_venuu_rank/
-- user_rank_movement depend on them and this migration touches both.
--
-- ✔ THE user_account_stats GAP (originally flagged here) IS NOW
-- COVERED — by 00070, which must run first. user_account_stats no
-- longer queries venue_recaps/night_plans as of that migration; this
-- one is safe to apply once 00070 has landed.
--
-- DRAFT ONLY. Not applied. Review before running `supabase db push`.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. user_venuu_rank — score formula only, columns unchanged ──

CREATE OR REPLACE VIEW public.user_venuu_rank AS
WITH scored AS (
  SELECT s.profile_id,
     s.auth_id,
     s.username,
     p.display_name,
     p.city AS home_city,
     p.avatar_color,
     p.avatar_url,
     p.profile_share_token,
     COALESCE(s.venues_discovered, 0) AS venues_discovered,
     COALESCE(s.total_recaps, 0) AS total_recaps,
     COALESCE(s.nights_out, 0) AS nights_out,
     COALESCE(s.plans_completed, 0) AS plans_completed,
     COALESCE(s.loyalty_bars_count, 0) AS loyalty_bars_count,
     COALESCE(s.venues_discovered, 0) * 100
       + COALESCE(s.nights_out, 0) * 50
       + COALESCE(s.loyalty_bars_count, 0) * 20 AS venuu_score
    FROM public.user_account_stats s
      JOIN public.profiles p ON p.id = s.profile_id
   WHERE COALESCE(p.leaderboard_excluded, false) = false
     AND COALESCE(p.is_active, true) = true
)
SELECT profile_id,
   auth_id,
   username,
   display_name,
   home_city,
   avatar_color,
   avatar_url,
   profile_share_token,
   venues_discovered,
   total_recaps,
   nights_out,
   plans_completed,
   loyalty_bars_count,
   venuu_score,
   rank() OVER (ORDER BY venuu_score DESC) AS global_rank,
   count(*) OVER () AS total_ranked,
   round((1::double precision - percent_rank() OVER (ORDER BY venuu_score DESC)) * 100::double precision)::integer AS top_percentile
  FROM scored;

GRANT ALL ON TABLE public.user_venuu_rank TO anon;
GRANT ALL ON TABLE public.user_venuu_rank TO authenticated;
GRANT ALL ON TABLE public.user_venuu_rank TO service_role;

-- ── 2. city_leaderboard — recap CTE + term removed (column set changes,
--       so DROP + CREATE rather than CREATE OR REPLACE) ──

DROP VIEW IF EXISTS public.city_leaderboard;

CREATE VIEW public.city_leaderboard AS
WITH city_visits AS (
  SELECT uv.user_id AS profile_id,
     ven.city,
     count(DISTINCT uv.venue_id) AS venues_in_city,
     count(DISTINCT uv.night_of) AS nights_in_city,
     count(*) AS visits_in_city
    FROM public.user_visits uv
      JOIN public.venues ven ON ven.id = uv.venue_id
   GROUP BY uv.user_id, ven.city
), scored AS (
  SELECT cv.profile_id,
     cv.city,
     cv.venues_in_city,
     cv.nights_in_city,
     cv.visits_in_city,
     (cv.venues_in_city * 100 + cv.nights_in_city * 50 + cv.visits_in_city * 10)::integer AS city_score
    FROM city_visits cv
)
SELECT sc.profile_id,
   sc.city,
   p.username,
   p.display_name,
   p.avatar_color,
   p.avatar_url,
   sc.venues_in_city,
   sc.nights_in_city,
   sc.visits_in_city,
   sc.city_score,
   rank() OVER (PARTITION BY sc.city ORDER BY sc.city_score DESC) AS city_rank,
   count(*) OVER (PARTITION BY sc.city) AS city_total_ranked
  FROM scored sc
    JOIN public.profiles p ON p.id = sc.profile_id
 WHERE COALESCE(p.leaderboard_excluded, false) = false
   AND COALESCE(p.is_active, true) = true
   AND sc.city_score > 0;

GRANT ALL ON TABLE public.city_leaderboard TO anon;
GRANT ALL ON TABLE public.city_leaderboard TO authenticated;
GRANT ALL ON TABLE public.city_leaderboard TO service_role;

-- ── 3. venue_leaderboard — same treatment: recap_agg CTE + term removed ──

DROP VIEW IF EXISTS public.venue_leaderboard;

CREATE VIEW public.venue_leaderboard AS
WITH visit_agg AS (
  SELECT user_visits.user_id AS profile_id,
     user_visits.venue_id,
     count(*) AS visit_count,
     count(DISTINCT user_visits.night_of) AS distinct_nights,
     COALESCE(sum(user_visits.duration_min), 0::bigint) AS total_minutes
    FROM public.user_visits
   GROUP BY user_visits.user_id, user_visits.venue_id
), scored AS (
  SELECT v.profile_id,
     v.venue_id,
     v.visit_count,
     v.distinct_nights,
     v.total_minutes,
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
   rank() OVER (PARTITION BY sc.venue_id ORDER BY sc.venue_score DESC) AS venue_rank
  FROM scored sc
    JOIN public.profiles p ON p.id = sc.profile_id
    JOIN public.venues ven ON ven.id = sc.venue_id
 WHERE COALESCE(p.leaderboard_excluded, false) = false
   AND COALESCE(p.is_active, true) = true
   AND sc.venue_score > 0;

GRANT ALL ON TABLE public.venue_leaderboard TO anon;
GRANT ALL ON TABLE public.venue_leaderboard TO authenticated;
GRANT ALL ON TABLE public.venue_leaderboard TO service_role;

-- ── 4. rank_snapshots — unchanged, recreated idempotently ──

CREATE SEQUENCE IF NOT EXISTS public.rank_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE IF NOT EXISTS public.rank_snapshots (
    id bigint NOT NULL DEFAULT nextval('public.rank_snapshots_id_seq'::regclass),
    profile_id uuid NOT NULL,
    snapshot_date date DEFAULT ((now() AT TIME ZONE 'America/New_York'::text))::date NOT NULL,
    global_rank integer,
    venuu_score integer
);

ALTER SEQUENCE public.rank_snapshots_id_seq OWNED BY public.rank_snapshots.id;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rank_snapshots_pkey') THEN
    ALTER TABLE public.rank_snapshots ADD CONSTRAINT rank_snapshots_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rank_snapshots_profile_id_snapshot_date_key') THEN
    ALTER TABLE public.rank_snapshots ADD CONSTRAINT rank_snapshots_profile_id_snapshot_date_key UNIQUE (profile_id, snapshot_date);
  END IF;
END $$;

ALTER TABLE public.rank_snapshots ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.rank_snapshots TO anon;
GRANT ALL ON TABLE public.rank_snapshots TO authenticated;
GRANT ALL ON TABLE public.rank_snapshots TO service_role;
GRANT ALL ON SEQUENCE public.rank_snapshots_id_seq TO anon;
GRANT ALL ON SEQUENCE public.rank_snapshots_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.rank_snapshots_id_seq TO service_role;

-- ── 5. user_rank_movement — unchanged logic; recreated because
--       user_venuu_rank (which it selects FROM) was just redefined ──

CREATE OR REPLACE VIEW public.user_rank_movement AS
WITH latest_prior AS (
  SELECT DISTINCT ON (rs.profile_id) rs.profile_id,
     rs.global_rank AS prior_rank
    FROM public.rank_snapshots rs
   WHERE rs.snapshot_date < (now() AT TIME ZONE 'America/New_York'::text)::date
   ORDER BY rs.profile_id, rs.snapshot_date DESC
)
SELECT r.profile_id,
   r.global_rank AS current_rank,
   lp.prior_rank,
       CASE
           WHEN lp.prior_rank IS NULL THEN NULL::bigint
           ELSE lp.prior_rank - r.global_rank
       END AS delta
  FROM public.user_venuu_rank r
    LEFT JOIN latest_prior lp ON lp.profile_id = r.profile_id;

GRANT ALL ON TABLE public.user_rank_movement TO anon;
GRANT ALL ON TABLE public.user_rank_movement TO authenticated;
GRANT ALL ON TABLE public.user_rank_movement TO service_role;

-- ── 6. snapshot_venuu_ranks() — unchanged, recreated idempotently ──

CREATE OR REPLACE FUNCTION public.snapshot_venuu_ranks() RETURNS void
    LANGUAGE sql SECURITY DEFINER
    AS $$
  INSERT INTO rank_snapshots (profile_id, snapshot_date, global_rank, venuu_score)
  SELECT profile_id, (now() AT TIME ZONE 'America/New_York')::date, global_rank, venuu_score
  FROM user_venuu_rank
  ON CONFLICT (profile_id, snapshot_date)
  DO UPDATE SET global_rank = EXCLUDED.global_rank, venuu_score = EXCLUDED.venuu_score;
$$;

DO $$
BEGIN
  RAISE NOTICE '-----------------------------------';
  RAISE NOTICE 'leaderboard: dropped total_recaps/plans_completed from venuu_score (00072)';
  RAISE NOTICE '  user_venuu_rank: 5-term formula -> 3-term (venues*100 + nights*50 + loyalty*20)';
  RAISE NOTICE '  city_leaderboard: recap CTE + term removed (column set changed, DROP+CREATE)';
  RAISE NOTICE '  venue_leaderboard: recap_agg CTE + term removed (column set changed, DROP+CREATE)';
  RAISE NOTICE '  rank_snapshots / snapshot_venuu_ranks() / user_rank_movement: unchanged, recreated';
  RAISE NOTICE '  user_account_stats no longer queries venue_recaps/night_plans as of 00070 —';
  RAISE NOTICE '  venue_recaps and night_plans now have zero live readers/writers in this chain.';
  RAISE NOTICE '-----------------------------------';
END $$;

COMMIT;
