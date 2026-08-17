-- ============================================================
-- LEADERBOARD VIEWS (the scoring formula)
-- ============================================================
-- user_venuu_rank
                                                                                                    pg_get_viewdef                                                                                                    
----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  WITH scored AS (                                                                                                                                                                                                   +
          SELECT s.profile_id,                                                                                                                                                                                       +
             s.auth_id,                                                                                                                                                                                              +
             s.username,                                                                                                                                                                                             +
             p.display_name,                                                                                                                                                                                         +
             p.city AS home_city,                                                                                                                                                                                    +
             p.avatar_color,                                                                                                                                                                                         +
             p.avatar_url,                                                                                                                                                                                           +
             p.profile_share_token,                                                                                                                                                                                  +
             COALESCE(s.venues_discovered, 0) AS venues_discovered,                                                                                                                                                  +
             COALESCE(s.total_recaps, 0) AS total_recaps,                                                                                                                                                            +
             COALESCE(s.nights_out, 0) AS nights_out,                                                                                                                                                                +
             COALESCE(s.plans_completed, 0) AS plans_completed,                                                                                                                                                      +
             COALESCE(s.loyalty_bars_count, 0) AS loyalty_bars_count,                                                                                                                                                +
             COALESCE(s.venues_discovered, 0) * 100 + COALESCE(s.total_recaps, 0) * 60 + COALESCE(s.nights_out, 0) * 50 + COALESCE(s.plans_completed, 0) * 40 + COALESCE(s.loyalty_bars_count, 0) * 20 AS venuu_score+
            FROM user_account_stats s                                                                                                                                                                                +
              JOIN profiles p ON p.id = s.profile_id                                                                                                                                                                 +
           WHERE COALESCE(p.leaderboard_excluded, false) = false AND COALESCE(p.is_active, true) = true                                                                                                              +
         )                                                                                                                                                                                                           +
  SELECT profile_id,                                                                                                                                                                                                 +
     auth_id,                                                                                                                                                                                                        +
     username,                                                                                                                                                                                                       +
     display_name,                                                                                                                                                                                                   +
     home_city,                                                                                                                                                                                                      +
     avatar_color,                                                                                                                                                                                                   +
     avatar_url,                                                                                                                                                                                                     +
     profile_share_token,                                                                                                                                                                                            +
     venues_discovered,                                                                                                                                                                                              +
     total_recaps,                                                                                                                                                                                                   +
     nights_out,                                                                                                                                                                                                     +
     plans_completed,                                                                                                                                                                                                +
     loyalty_bars_count,                                                                                                                                                                                             +
     venuu_score,                                                                                                                                                                                                    +
     rank() OVER (ORDER BY venuu_score DESC) AS global_rank,                                                                                                                                                         +
     count(*) OVER () AS total_ranked,                                                                                                                                                                               +
     round((1::double precision - percent_rank() OVER (ORDER BY venuu_score DESC)) * 100::double precision)::integer AS top_percentile                                                                               +
    FROM scored;
(1 row)

-- city_leaderboard
                                                           pg_get_viewdef                                                            
-------------------------------------------------------------------------------------------------------------------------------------
  WITH city_visits AS (                                                                                                             +
          SELECT uv.user_id AS profile_id,                                                                                          +
             ven.city,                                                                                                              +
             count(DISTINCT uv.venue_id) AS venues_in_city,                                                                         +
             count(DISTINCT uv.night_of) AS nights_in_city,                                                                         +
             count(*) AS visits_in_city                                                                                             +
            FROM user_visits uv                                                                                                     +
              JOIN venues ven ON ven.id = uv.venue_id                                                                               +
           GROUP BY uv.user_id, ven.city                                                                                            +
         ), city_recaps AS (                                                                                                        +
          SELECT vr.user_id AS profile_id,                                                                                          +
             ven.city,                                                                                                              +
             count(*) AS recaps_in_city                                                                                             +
            FROM venue_recaps vr                                                                                                    +
              JOIN venues ven ON ven.id = vr.venue_id                                                                               +
           WHERE vr.user_id IS NOT NULL                                                                                             +
           GROUP BY vr.user_id, ven.city                                                                                            +
         ), combined AS (                                                                                                           +
          SELECT COALESCE(cv.profile_id, cr.profile_id) AS profile_id,                                                              +
             COALESCE(cv.city, cr.city) AS city,                                                                                    +
             COALESCE(cv.venues_in_city, 0::bigint) AS venues_in_city,                                                              +
             COALESCE(cv.nights_in_city, 0::bigint) AS nights_in_city,                                                              +
             COALESCE(cv.visits_in_city, 0::bigint) AS visits_in_city,                                                              +
             COALESCE(cr.recaps_in_city, 0::bigint) AS recaps_in_city                                                               +
            FROM city_visits cv                                                                                                     +
              FULL JOIN city_recaps cr ON cv.profile_id = cr.profile_id AND cv.city::text = cr.city::text                           +
         ), scored AS (                                                                                                             +
          SELECT c.profile_id,                                                                                                      +
             c.city,                                                                                                                +
             c.venues_in_city,                                                                                                      +
             c.nights_in_city,                                                                                                      +
             c.visits_in_city,                                                                                                      +
             c.recaps_in_city,                                                                                                      +
             (c.venues_in_city * 100 + c.recaps_in_city * 60 + c.nights_in_city * 50 + c.visits_in_city * 10)::integer AS city_score+
            FROM combined c                                                                                                         +
         )                                                                                                                          +
  SELECT sc.profile_id,                                                                                                             +
     sc.city,                                                                                                                       +
     p.username,                                                                                                                    +
     p.display_name,                                                                                                                +
     p.avatar_color,                                                                                                                +
     p.avatar_url,                                                                                                                  +
     sc.venues_in_city,                                                                                                             +
     sc.nights_in_city,                                                                                                             +
     sc.visits_in_city,                                                                                                             +
     sc.recaps_in_city,                                                                                                             +
     sc.city_score,                                                                                                                 +
     rank() OVER (PARTITION BY sc.city ORDER BY sc.city_score DESC) AS city_rank,                                                   +
     count(*) OVER (PARTITION BY sc.city) AS city_total_ranked                                                                      +
    FROM scored sc                                                                                                                  +
      JOIN profiles p ON p.id = sc.profile_id                                                                                       +
   WHERE COALESCE(p.leaderboard_excluded, false) = false AND COALESCE(p.is_active, true) = true AND sc.city_score > 0;
(1 row)

-- venue_leaderboard
                                                                             pg_get_viewdef                                                                             
------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  WITH visit_agg AS (                                                                                                                                                  +
          SELECT user_visits.user_id AS profile_id,                                                                                                                    +
             user_visits.venue_id,                                                                                                                                     +
             count(*) AS visit_count,                                                                                                                                  +
             count(DISTINCT user_visits.night_of) AS distinct_nights,                                                                                                  +
             COALESCE(sum(user_visits.duration_min), 0::bigint) AS total_minutes                                                                                       +
            FROM user_visits                                                                                                                                           +
           GROUP BY user_visits.user_id, user_visits.venue_id                                                                                                          +
         ), recap_agg AS (                                                                                                                                             +
          SELECT venue_recaps.user_id AS profile_id,                                                                                                                   +
             venue_recaps.venue_id,                                                                                                                                    +
             count(*) AS recap_count                                                                                                                                   +
            FROM venue_recaps                                                                                                                                          +
           WHERE venue_recaps.user_id IS NOT NULL                                                                                                                      +
           GROUP BY venue_recaps.user_id, venue_recaps.venue_id                                                                                                        +
         ), combined AS (                                                                                                                                              +
          SELECT COALESCE(v.profile_id, r.profile_id) AS profile_id,                                                                                                   +
             COALESCE(v.venue_id, r.venue_id) AS venue_id,                                                                                                             +
             COALESCE(v.visit_count, 0::bigint) AS visit_count,                                                                                                        +
             COALESCE(v.distinct_nights, 0::bigint) AS distinct_nights,                                                                                                +
             COALESCE(v.total_minutes, 0::bigint) AS total_minutes,                                                                                                    +
             COALESCE(r.recap_count, 0::bigint) AS recap_count                                                                                                         +
            FROM visit_agg v                                                                                                                                           +
              FULL JOIN recap_agg r ON v.profile_id = r.profile_id AND v.venue_id = r.venue_id                                                                         +
         ), scored AS (                                                                                                                                                +
          SELECT c.profile_id,                                                                                                                                         +
             c.venue_id,                                                                                                                                               +
             c.visit_count,                                                                                                                                            +
             c.distinct_nights,                                                                                                                                        +
             c.total_minutes,                                                                                                                                          +
             c.recap_count,                                                                                                                                            +
             ((c.visit_count * 10 + c.distinct_nights * 15 + c.recap_count * 30)::numeric + LEAST(c.total_minutes, 600::bigint)::numeric * 0.3)::integer AS venue_score+
            FROM combined c                                                                                                                                            +
         )                                                                                                                                                             +
  SELECT sc.profile_id,                                                                                                                                                +
     sc.venue_id,                                                                                                                                                      +
     ven.name AS venue_name,                                                                                                                                           +
     ven.slug AS venue_slug,                                                                                                                                           +
     ven.city,                                                                                                                                                         +
     p.username,                                                                                                                                                       +
     p.display_name,                                                                                                                                                   +
     p.avatar_color,                                                                                                                                                   +
     p.avatar_url,                                                                                                                                                     +
     sc.visit_count,                                                                                                                                                   +
     sc.distinct_nights,                                                                                                                                               +
     sc.total_minutes,                                                                                                                                                 +
     sc.recap_count,                                                                                                                                                   +
     sc.venue_score,                                                                                                                                                   +
     rank() OVER (PARTITION BY sc.venue_id ORDER BY sc.venue_score DESC) AS venue_rank                                                                                 +
    FROM scored sc                                                                                                                                                     +
      JOIN profiles p ON p.id = sc.profile_id                                                                                                                          +
      JOIN venues ven ON ven.id = sc.venue_id                                                                                                                          +
   WHERE COALESCE(p.leaderboard_excluded, false) = false AND COALESCE(p.is_active, true) = true AND sc.venue_score > 0;
(1 row)

-- user_rank_movement
                                     pg_get_viewdef                                     
----------------------------------------------------------------------------------------
  WITH latest_prior AS (                                                               +
          SELECT DISTINCT ON (rs.profile_id) rs.profile_id,                            +
             rs.global_rank AS prior_rank                                              +
            FROM rank_snapshots rs                                                     +
           WHERE rs.snapshot_date < (now() AT TIME ZONE 'America/New_York'::text)::date+
           ORDER BY rs.profile_id, rs.snapshot_date DESC                               +
         )                                                                             +
  SELECT r.profile_id,                                                                 +
     r.global_rank AS current_rank,                                                    +
     lp.prior_rank,                                                                    +
         CASE                                                                          +
             WHEN lp.prior_rank IS NULL THEN NULL::bigint                              +
             ELSE lp.prior_rank - r.global_rank                                        +
         END AS delta                                                                  +
    FROM user_venuu_rank r                                                             +
      LEFT JOIN latest_prior lp ON lp.profile_id = r.profile_id;
(1 row)

-- ============================================================
-- UNDOCUMENTED RPCs
-- ============================================================
-- record_paint
                                                                              pg_get_functiondef                                                                              
------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 CREATE OR REPLACE FUNCTION public.record_paint(p_venue_id uuid, p_hue_id integer, p_visit_first_seen_at timestamp with time zone, p_paint_prompt_id uuid DEFAULT NULL::uuid)+
  RETURNS uuid                                                                                                                                                               +
  LANGUAGE plpgsql                                                                                                                                                           +
  SECURITY DEFINER                                                                                                                                                           +
  SET search_path TO 'public'                                                                                                                                                +
 AS $function$                                                                                                                                                               +
 DECLARE                                                                                                                                                                     +
   v_auth_uid uuid;                                                                                                                                                          +
   v_time_band text;                                                                                                                                                         +
   v_eastern_ts timestamptz;                                                                                                                                                 +
   v_dow integer;                                                                                                                                                            +
   v_hour integer;                                                                                                                                                           +
   v_rating_id uuid;                                                                                                                                                         +
 BEGIN                                                                                                                                                                       +
   v_auth_uid := auth.uid();                                                                                                                                                 +
   IF v_auth_uid IS NULL THEN                                                                                                                                                +
     RAISE EXCEPTION 'not authenticated';                                                                                                                                    +
   END IF;                                                                                                                                                                   +
                                                                                                                                                                             +
   -- Compute time_band (US Eastern). Matches public.current_time_band().                                                                                                    +
   v_eastern_ts := p_visit_first_seen_at AT TIME ZONE 'America/New_York';                                                                                                    +
   v_dow := EXTRACT(DOW FROM v_eastern_ts)::int;                                                                                                                             +
   v_hour := EXTRACT(HOUR FROM v_eastern_ts)::int;                                                                                                                           +
                                                                                                                                                                             +
   IF v_dow BETWEEN 5 AND 6 THEN                                                                                                                                             +
     IF v_hour >= 17 AND v_hour < 21 THEN                                                                                                                                    +
       v_time_band := 'wknd_early';                                                                                                                                          +
     ELSE                                                                                                                                                                    +
       v_time_band := 'wknd_peak';                                                                                                                                           +
     END IF;                                                                                                                                                                 +
   ELSE                                                                                                                                                                      +
     IF v_hour >= 17 AND v_hour < 21 THEN                                                                                                                                    +
       v_time_band := 'wk_early';                                                                                                                                            +
     ELSE                                                                                                                                                                    +
       v_time_band := 'wk_peak';                                                                                                                                             +
     END IF;                                                                                                                                                                 +
   END IF;                                                                                                                                                                   +
                                                                                                                                                                             +
   -- INSERT vibe_ratings with auth.uid() as user_id (matches Phase A schema)                                                                                                +
   INSERT INTO public.vibe_ratings (user_id, venue_id, hue_id, time_band)                                                                                                    +
   VALUES (v_auth_uid, p_venue_id, p_hue_id, v_time_band)                                                                                                                    +
   RETURNING id INTO v_rating_id;                                                                                                                                            +
                                                                                                                                                                             +
   -- Link paint_prompt (its user_id is profiles.id; we look it up via auth_id)                                                                                              +
   IF p_paint_prompt_id IS NOT NULL THEN                                                                                                                                     +
     UPDATE public.paint_prompts                                                                                                                                             +
     SET status = 'painted',                                                                                                                                                 +
         painted_at = now(),                                                                                                                                                 +
         vibe_rating_id = v_rating_id                                                                                                                                        +
     WHERE id = p_paint_prompt_id;                                                                                                                                           +
   END IF;                                                                                                                                                                   +
                                                                                                                                                                             +
   RETURN v_rating_id;                                                                                                                                                       +
 EXCEPTION                                                                                                                                                                   +
   WHEN unique_violation THEN                                                                                                                                                +
     SELECT id INTO v_rating_id                                                                                                                                              +
     FROM public.vibe_ratings                                                                                                                                                +
     WHERE user_id = v_auth_uid AND venue_id = p_venue_id                                                                                                                    +
     LIMIT 1;                                                                                                                                                                +
                                                                                                                                                                             +
     IF p_paint_prompt_id IS NOT NULL AND v_rating_id IS NOT NULL THEN                                                                                                       +
       UPDATE public.paint_prompts                                                                                                                                           +
       SET status = 'painted',                                                                                                                                               +
           painted_at = now(),                                                                                                                                               +
           vibe_rating_id = v_rating_id                                                                                                                                      +
       WHERE id = p_paint_prompt_id AND status != 'painted';                                                                                                                 +
     END IF;                                                                                                                                                                 +
                                                                                                                                                                             +
     RETURN v_rating_id;                                                                                                                                                     +
 END $function$                                                                                                                                                              +
 
(1 row)

-- delete_user_account
                      pg_get_functiondef                       
---------------------------------------------------------------
 CREATE OR REPLACE FUNCTION public.delete_user_account()      +
  RETURNS void                                                +
  LANGUAGE plpgsql                                            +
  SECURITY DEFINER                                            +
 AS $function$                                                +
 BEGIN                                                        +
   DELETE FROM loyalty_visits WHERE user_id = auth.uid();     +
   DELETE FROM cover_purchases WHERE user_id = auth.uid();    +
   DELETE FROM loyalty_redemptions WHERE user_id = auth.uid();+
   DELETE FROM push_tokens WHERE user_id = auth.uid();        +
   DELETE FROM profiles WHERE auth_id = auth.uid();           +
   DELETE FROM auth.users WHERE id = auth.uid();              +
 END;                                                         +
 $function$                                                   +
 
(1 row)

-- ============================================================
-- Existence/signature cross-check
-- ============================================================
 schemaname |      viewname      
------------+--------------------
 public     | user_rank_movement
 public     | city_leaderboard
 public     | venue_leaderboard
 public     | user_venuu_rank
(4 rows)

 nspname |       proname       |                                    pg_get_function_identity_arguments                                     
---------+---------------------+-----------------------------------------------------------------------------------------------------------
 public  | record_paint        | p_venue_id uuid, p_hue_id integer, p_visit_first_seen_at timestamp with time zone, p_paint_prompt_id uuid
 public  | delete_user_account | 
(2 rows)

