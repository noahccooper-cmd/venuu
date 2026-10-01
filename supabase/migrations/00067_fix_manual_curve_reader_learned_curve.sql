-- ═══════════════════════════════════════════════════════════════
-- 00067_fix_manual_curve_reader_learned_curve.sql
--
-- Step 2 of the manual-curve engine integration. Fixes a long-standing
-- silent bug, ends the schema drift, and readies the socket for the
-- operator (Karston) capacity curves.
--
-- THREE CHANGES vs the live body of get_current_hour_from_manual_curve:
--
--   1. READS learned_curve, NOT the phantom `manual_curve` column.
--      The live function references a column that DOES NOT EXIST, so
--      it has silently returned NULL (via its EXCEPTION guard) every
--      fusion tick since it was written. `learned_curve jsonb` already
--      exists on venue_baselines (00006) and is empty (0 rows) — it is
--      our curve home, zero schema change. This is the change that makes
--      the function actually work once curves are loaded.
--
--   2. INTERPOLATES between hourly anchors. Instead of a flat hourly
--      lookup, blend the current hour's value and the next hour's value
--      by the fraction of minutes elapsed in the current hour — so the
--      estimate (and the market ticker) glides smoothly instead of
--      stepping on the hour.
--        • Midnight handling: hour 23 returns its value FLAT — no
--          cross-day lookup, no smear past 23:00.
--        • If the next hour's value is missing/null, return the current
--          hour's value flat.
--
--   3. KEEPS the EXCEPTION WHEN OTHERS THEN RETURN NULL guard plus all
--      NULL/shape safety: a null curve, non-object curve, missing or
--      non-array day, or any parse error returns NULL cleanly so the
--      venue falls through to the next cascade tier. The function NEVER
--      raises. (Combined with 00066's per-venue loop isolation, that's
--      belt-and-suspenders.)
--
-- Preserved from the live body: SECURITY DEFINER, search_path,
-- America/New_York local time, RETURNS int, and the day-of-week mapping
-- used by the sibling BestTime reader get_current_hour_from_curve
-- (00014): Postgres DOW (0=Sun..6=Sat) → Operator-sheet day_int
-- (Monday=0 … Saturday=5, Sunday=6) via (pg_dow + 6) % 7.
--
-- EXPECTED learned_curve JSONB SHAPE:
--   { "0": [24 ints, Monday], "1": [...], … "6": [...Sunday] }
--   String day keys "0".."6"; each a 24-element integer array indexed
--   by hour-of-day (0..23), values 0..100 (busyness %).
--
-- NO-OP UNTIL CURVE DATA IS LOADED: learned_curve is empty, so this
-- returns NULL for every venue today — identical to current behavior.
-- Zero risk to the locked 40/21/22 baseline; it only fixes the wiring.
--
-- Idempotent (CREATE OR REPLACE). Wrapped in BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.get_current_hour_from_manual_curve(p_venue_id uuid)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_curve      jsonb;
  v_local_now  timestamp;
  v_hour       int;
  v_minute     int;
  v_pg_dow     int;
  v_day_key    text;
  v_day_array  jsonb;
  v_cur_txt    text;
  v_next_txt   text;
  v_cur_val    numeric;
  v_next_val   numeric;
  v_frac       numeric;
  v_result     numeric;
BEGIN
  -- Read the manual operator curve. CHANGE #1: learned_curve, not the
  -- phantom 'manual_curve' column the prior live body referenced.
  SELECT learned_curve INTO v_curve
  FROM public.venue_baselines WHERE venue_id = p_venue_id;

  -- Shape guard: missing or non-object curve → fall through cleanly.
  IF v_curve IS NULL OR jsonb_typeof(v_curve) <> 'object' THEN
    RETURN NULL;
  END IF;

  v_local_now := (now() AT TIME ZONE 'America/New_York');
  v_hour      := EXTRACT(HOUR   FROM v_local_now)::int;   -- 0..23
  v_minute    := EXTRACT(MINUTE FROM v_local_now)::int;   -- 0..59
  v_pg_dow    := EXTRACT(DOW    FROM v_local_now)::int;   -- 0=Sun..6=Sat

  -- Operator day_int: Monday=0 … Saturday=5, Sunday=6.
  -- (pg_dow + 6) % 7 — identical convention to get_current_hour_from_curve.
  v_day_key := ((v_pg_dow + 6) % 7)::text;

  -- Day array guard: missing or non-array → fall through cleanly.
  v_day_array := v_curve -> v_day_key;
  IF v_day_array IS NULL OR jsonb_typeof(v_day_array) <> 'array' THEN
    RETURN NULL;
  END IF;

  -- Current hour's value. Missing/null → fall through (no manual datum
  -- for this hour means defer to the next tier, not assert "0% busy").
  v_cur_txt := v_day_array ->> v_hour;
  IF v_cur_txt IS NULL OR v_cur_txt = 'null' THEN
    RETURN NULL;
  END IF;
  v_cur_val := v_cur_txt::numeric;

  -- CHANGE #2 (midnight handling): hour 23 has no in-day next hour.
  -- Return flat — no cross-day lookup, no smear across the boundary.
  IF v_hour >= 23 THEN
    RETURN ROUND(v_cur_val)::int;
  END IF;

  -- Next hour's value. Missing/null → return current hour flat.
  v_next_txt := v_day_array ->> (v_hour + 1);
  IF v_next_txt IS NULL OR v_next_txt = 'null' THEN
    RETURN ROUND(v_cur_val)::int;
  END IF;
  v_next_val := v_next_txt::numeric;

  -- CHANGE #2 (interpolation): blend by minutes elapsed in the hour.
  -- e.g. 10:30 → halfway between h10 and h11.
  v_frac   := v_minute::numeric / 60.0;
  v_result := v_cur_val + (v_next_val - v_cur_val) * v_frac;

  RETURN ROUND(v_result)::int;

EXCEPTION
  -- CHANGE #3: any unforeseen parse/type error → NULL, never raise.
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_current_hour_from_manual_curve(uuid)
  TO service_role, authenticated;

DO $$
BEGIN
  RAISE NOTICE '-----------------------------------';
  RAISE NOTICE 'get_current_hour_from_manual_curve fixed (00067)';
  RAISE NOTICE '  reads learned_curve (was: phantom manual_curve column)';
  RAISE NOTICE '  interpolates between hourly anchors; hour 23 flat';
  RAISE NOTICE '  NULL-safe + EXCEPTION guard preserved (never raises)';
  RAISE NOTICE '  no-op until learned_curve data is loaded (empty today)';
  RAISE NOTICE '-----------------------------------';
END $$;

COMMIT;
