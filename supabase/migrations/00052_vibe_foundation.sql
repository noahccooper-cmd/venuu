-- ════════════════════════════════════════════════════════════════
-- 00052_vibe_foundation.sql
--
-- The Soul Document, materialized in Postgres.
--
-- Adds the vibe color system to the venuu data layer.
-- HUE = vibe identity (which of 14 hues defines this venue)
-- SATURATION + LIGHTNESS computed client-side from state + capacity.
--
-- Authored from the lake-weekend founder seed: Noah, Karston, Mike.
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Part 1: Rename legacy vibe column to vibe_tagline ────────────
-- The text column previously called "vibe" stored marketing copy
-- ("THE college bar", etc). It's not vibe-as-identity. Renaming it
-- frees the word "vibe" for the new color identity system.

ALTER TABLE public.venues
  RENAME COLUMN vibe TO vibe_tagline;

COMMENT ON COLUMN public.venues.vibe_tagline IS
  'Legacy marketing copy / tagline. Distinct from vibe_hue_baseline.';

-- ─── Part 2: Add vibe_hue_baseline JSONB column ───────────────────
-- Stores the founder-authored hue per time band:
--   { wk_early: 7, wk_peak: 10, wknd_early: 9, wknd_peak: 10 }
-- Hue IDs are 1-14 from the spectrum (see vibe_hue_lookup below).

ALTER TABLE public.venues
  ADD COLUMN vibe_hue_baseline JSONB;

ALTER TABLE public.venues
  ADD COLUMN vibe_disagreement BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.venues.vibe_hue_baseline IS
  'Founder-authored hue per time band. Keys: wk_early, wk_peak, wknd_early, wknd_peak. Values: 1-14.';
COMMENT ON COLUMN public.venues.vibe_disagreement IS
  'True if founders did not agree on baseline. Triggers faster decay so user paints override sooner.';

-- ─── Part 3: vibe_hue_lookup table (the 14-hue spectrum) ──────────

CREATE TABLE public.vibe_hue_lookup (
  hue_id INTEGER PRIMARY KEY CHECK (hue_id BETWEEN 1 AND 14),
  hue_name TEXT NOT NULL,
  hsl_degrees INTEGER NOT NULL CHECK (hsl_degrees BETWEEN 0 AND 360),
  default_saturation INTEGER NOT NULL CHECK (default_saturation BETWEEN 0 AND 100),
  display_hex TEXT NOT NULL,
  internal_anchor TEXT,
  spectrum_order INTEGER NOT NULL
);

INSERT INTO public.vibe_hue_lookup (hue_id, hue_name, hsl_degrees, default_saturation, display_hex, internal_anchor, spectrum_order) VALUES
  (1,  'Deep Indigo',        250, 45, '#2E2A6E', 'after-hours, intimate, very late',    1),
  (2,  'Royal Blue',          220, 65, '#3B5BDB', 'cocktail polish, sleek, after-work',  2),
  (3,  'Sky / Cyan',          190, 55, '#3FB8C9', 'daylight chill, café, brunch',        3),
  (4,  'Sea Green',           165, 55, '#1FB58D', 'patio energy, easy, mid-week',        4),
  (5,  'Fresh Green',         130, 50, '#52C66A', 'dinner, grounded, casual restaurant', 5),
  (6,  'Olive / Sage',         80, 40, '#9CB257', 'wine bar, slower conversation',       6),
  (7,  'Yellow-Gold',          45, 75, '#FFD56B', 'warming up, neighborhood bar',        7),
  (8,  'Warm Orange',          30, 90, '#FF8200', 'loud bar, mid-energy, college',       8),
  (9,  'Deep Orange',          18, 90, '#FF5B1E', 'packed bar, full warmth',             9),
  (10, 'Crimson Red',         350, 75, '#E63956', 'rage, dance floor, peak',            10),
  (11, 'Wine / Burgundy',     335, 65, '#8E1B3A', 'darker club, harder edge',           11),
  (12, 'Magenta / Plum',      315, 55, '#A4308E', 'alt scene, queer venues, art',       12),
  (13, 'Violet',              270, 55, '#7A4DC9', 'mood lounge, intimate dance',        13),
  (14, 'Cool Grey-Lavender',  240, 18, '#9098B8', 'off-peak any venue, restful',        14);

-- Public read; no writes from clients
ALTER TABLE public.vibe_hue_lookup ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON public.vibe_hue_lookup FOR SELECT USING (true);

-- ─── Part 4: vibe_ratings table (user paints) ─────────────────────
-- One paint per (user, venue). First paint is permanent — enforced
-- by UNIQUE constraint and no UPDATE policy.

CREATE TABLE public.vibe_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  hue_id INTEGER NOT NULL REFERENCES public.vibe_hue_lookup(hue_id),
  time_band TEXT NOT NULL CHECK (time_band IN ('wk_early', 'wk_peak', 'wknd_early', 'wknd_peak')),
  painted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  visit_id UUID REFERENCES public.user_visits(id) ON DELETE SET NULL,
  UNIQUE (user_id, venue_id)
);

CREATE INDEX idx_vibe_ratings_venue ON public.vibe_ratings(venue_id);
CREATE INDEX idx_vibe_ratings_user ON public.vibe_ratings(user_id);
CREATE INDEX idx_vibe_ratings_painted_at ON public.vibe_ratings(painted_at DESC);

ALTER TABLE public.vibe_ratings ENABLE ROW LEVEL SECURITY;

-- Users can insert their own paint
CREATE POLICY "Users insert own paint" ON public.vibe_ratings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can read their own paints (for "your venues" list)
CREATE POLICY "Users read own paints" ON public.vibe_ratings
  FOR SELECT USING (auth.uid() = user_id);

-- Anyone can read aggregate paint data via the function below; no
-- direct SELECT policy for other users' paints (privacy).

-- NO UPDATE policy — first paint is permanent.
-- NO DELETE policy — paint cannot be undone.

-- ─── Part 5: Functions ────────────────────────────────────────────

-- Returns the current time band based on venue's local time.
-- Knoxville and Tampa/St.Pete are all America/New_York.
CREATE OR REPLACE FUNCTION public.current_time_band()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_local TIMESTAMP;
  v_dow INTEGER;
  v_hour INTEGER;
  v_is_weekend BOOLEAN;
  v_is_peak BOOLEAN;
BEGIN
  v_local := (now() AT TIME ZONE 'America/New_York');
  v_dow := EXTRACT(DOW FROM v_local)::INTEGER;
  v_hour := EXTRACT(HOUR FROM v_local)::INTEGER;

  -- Weekend = Fri (5) or Sat (6). Sunday early-morning hours count as Sat night.
  v_is_weekend := v_dow IN (5, 6) OR (v_dow = 0 AND v_hour < 4);

  -- Peak = 9pm-close (9pm-4am). Early = 5pm-9pm.
  v_is_peak := v_hour >= 21 OR v_hour < 4;

  IF v_is_weekend AND v_is_peak THEN
    RETURN 'wknd_peak';
  ELSIF v_is_weekend THEN
    RETURN 'wknd_early';
  ELSIF v_is_peak THEN
    RETURN 'wk_peak';
  ELSE
    RETURN 'wk_early';
  END IF;
END;
$$;

-- Returns the venue's baseline hue for the current time band.
CREATE OR REPLACE FUNCTION public.get_venue_baseline_hue(p_venue_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_baseline JSONB;
  v_band TEXT;
  v_hue INTEGER;
BEGIN
  SELECT vibe_hue_baseline INTO v_baseline FROM public.venues WHERE id = p_venue_id;
  IF v_baseline IS NULL THEN RETURN NULL; END IF;

  v_band := public.current_time_band();
  v_hue := (v_baseline->>v_band)::INTEGER;

  RETURN v_hue;
END;
$$;

-- Returns the venue's CURRENT hue: a fusion of baseline + user paints
-- weighted by decay. Recent paints carry more weight. After enough
-- paints, baseline becomes negligible.
--
-- Algorithm:
--   - Pull all paints for this venue from the matching time band
--   - Each paint weighted by exp(-days_old / half_life)
--   - half_life = 14 days normally, 7 days if vibe_disagreement = true
--   - Baseline weight = max(1.0, 3.0 - 0.1 * paint_count) so it fades
--     as user data accumulates
--   - Circular mean on HSL degrees (hues are angles on a wheel)
--   - Returns the closest hue_id from the spectrum
CREATE OR REPLACE FUNCTION public.get_venue_current_hue(p_venue_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_band TEXT;
  v_baseline_hue INTEGER;
  v_baseline_degrees NUMERIC;
  v_disagreement BOOLEAN;
  v_half_life NUMERIC;
  v_paint_count INTEGER;
  v_baseline_weight NUMERIC;
  v_x NUMERIC := 0;  -- circular mean accumulator
  v_y NUMERIC := 0;
  v_total_weight NUMERIC := 0;
  v_paint RECORD;
  v_age_days NUMERIC;
  v_weight NUMERIC;
  v_mean_angle NUMERIC;
  v_closest_hue INTEGER;
  v_min_dist NUMERIC := 360;
  v_hue_row RECORD;
  v_dist NUMERIC;
BEGIN
  v_band := public.current_time_band();

  SELECT (vibe_hue_baseline->>v_band)::INTEGER, vibe_disagreement
    INTO v_baseline_hue, v_disagreement
    FROM public.venues WHERE id = p_venue_id;

  IF v_baseline_hue IS NULL THEN RETURN NULL; END IF;

  v_half_life := CASE WHEN v_disagreement THEN 7.0 ELSE 14.0 END;

  -- Look up baseline's HSL degrees
  SELECT hsl_degrees INTO v_baseline_degrees
    FROM public.vibe_hue_lookup WHERE hue_id = v_baseline_hue;

  -- Count recent paints
  SELECT COUNT(*) INTO v_paint_count
    FROM public.vibe_ratings
    WHERE venue_id = p_venue_id
      AND time_band = v_band
      AND painted_at > now() - interval '90 days';

  -- Baseline weight fades as paint count grows; floor at 1.0
  v_baseline_weight := GREATEST(1.0, 3.0 - 0.1 * v_paint_count);

  -- Seed circular mean with baseline
  v_x := v_x + v_baseline_weight * COS(RADIANS(v_baseline_degrees));
  v_y := v_y + v_baseline_weight * SIN(RADIANS(v_baseline_degrees));
  v_total_weight := v_total_weight + v_baseline_weight;

  -- Add weighted user paints
  FOR v_paint IN
    SELECT vr.hue_id, vr.painted_at, vhl.hsl_degrees
    FROM public.vibe_ratings vr
    JOIN public.vibe_hue_lookup vhl ON vhl.hue_id = vr.hue_id
    WHERE vr.venue_id = p_venue_id
      AND vr.time_band = v_band
      AND vr.painted_at > now() - interval '90 days'
  LOOP
    v_age_days := EXTRACT(EPOCH FROM (now() - v_paint.painted_at)) / 86400.0;
    v_weight := EXP(-v_age_days / v_half_life);
    v_x := v_x + v_weight * COS(RADIANS(v_paint.hsl_degrees));
    v_y := v_y + v_weight * SIN(RADIANS(v_paint.hsl_degrees));
    v_total_weight := v_total_weight + v_weight;
  END LOOP;

  -- Convert circular mean back to degrees (0-360)
  v_mean_angle := DEGREES(ATAN2(v_y, v_x));
  IF v_mean_angle < 0 THEN v_mean_angle := v_mean_angle + 360; END IF;

  -- Find the closest hue_id by angular distance
  FOR v_hue_row IN
    SELECT hue_id, hsl_degrees FROM public.vibe_hue_lookup
  LOOP
    v_dist := ABS(v_mean_angle - v_hue_row.hsl_degrees);
    IF v_dist > 180 THEN v_dist := 360 - v_dist; END IF;
    IF v_dist < v_min_dist THEN
      v_min_dist := v_dist;
      v_closest_hue := v_hue_row.hue_id;
    END IF;
  END LOOP;

  RETURN v_closest_hue;
END;
$$;

GRANT EXECUTE ON FUNCTION public.current_time_band() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_venue_baseline_hue(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_venue_current_hue(UUID) TO authenticated, anon;

-- ─── Part 6: Seed founder baselines from the lake document ────────
-- Hue ID mapping reminder (from vibe_hue_lookup):
--   1 Deep Indigo · 2 Royal Blue · 3 Sky/Cyan · 4 Sea Green · 5 Fresh Green
--   6 Olive · 7 Yellow-Gold · 8 Warm Orange · 9 Deep Orange · 10 Crimson
--   11 Wine · 12 Magenta · 13 Violet · 14 Grey-Lavender

-- KNOXVILLE
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 7,  "wk_peak": 10, "wknd_early": 9,  "wknd_peak": 10}'::jsonb WHERE name = 'The Bookstore'        AND city = 'knoxville';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 7,  "wk_peak": 9,  "wknd_early": 7,  "wknd_peak": 9}'::jsonb  WHERE name = 'Half Barrel'           AND city = 'knoxville';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 9,  "wk_peak": 10, "wknd_early": 9,  "wknd_peak": 10}'::jsonb WHERE name = 'Hannas'                AND city = 'knoxville';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 14, "wk_peak": 13, "wknd_early": 14, "wknd_peak": 13}'::jsonb WHERE name = 'LunaVerse'             AND city = 'knoxville';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 14, "wk_peak": 9,  "wknd_early": 14, "wknd_peak": 9}'::jsonb  WHERE name = 'Yacht Club'            AND city = 'knoxville';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 9,  "wk_peak": 10, "wknd_early": 9,  "wknd_peak": 10}'::jsonb WHERE name = 'LiterBoard'            AND city = 'knoxville';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 9,  "wk_peak": 10, "wknd_early": 9,  "wknd_peak": 10}'::jsonb WHERE name = 'Undeclared'            AND city = 'knoxville';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 14, "wk_peak": 3,  "wknd_early": 14, "wknd_peak": 3}'::jsonb  WHERE name = 'Southside Garage'      AND city = 'knoxville';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 5,  "wk_peak": 5,  "wknd_early": 5,  "wknd_peak": 5}'::jsonb  WHERE name LIKE 'Kern''s%'             AND city = 'knoxville';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 5,  "wk_peak": 2,  "wknd_early": 6,  "wknd_peak": 5}'::jsonb  WHERE name = 'Sunspot'                AND city = 'knoxville';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 5,  "wk_peak": 3,  "wknd_early": 5,  "wknd_peak": 3}'::jsonb  WHERE name = 'Yee-Haw Brewing'        AND city = 'knoxville';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 6,  "wk_peak": 8,  "wknd_early": 4,  "wknd_peak": 8}'::jsonb  WHERE name = 'Old City Sports Bar'   AND city = 'knoxville';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 7,  "wk_peak": 9,  "wknd_early": 3,  "wknd_peak": 9}'::jsonb  WHERE name LIKE 'The Hill Bar%'        AND city = 'knoxville';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 2,  "wk_peak": 2,  "wknd_early": 2,  "wknd_peak": 2}'::jsonb  WHERE name = 'Radius'                 AND city = 'knoxville';

-- TAMPA
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 7,  "wk_peak": 9,  "wknd_early": 8,  "wknd_peak": 10}'::jsonb WHERE name = 'Embird'                AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 9,  "wk_peak": 10, "wknd_early": 9,  "wknd_peak": 10}'::jsonb WHERE name = 'Lower Deck'            AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 5,  "wk_peak": 8,  "wknd_early": 8,  "wknd_peak": 9}'::jsonb  WHERE name = 'American Social'        AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 13, "wk_peak": 11, "wknd_early": 13, "wknd_peak": 11}'::jsonb WHERE name = 'Echo'                   AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 13, "wk_peak": 11, "wknd_early": 13, "wknd_peak": 10}'::jsonb WHERE name = 'Delta'                  AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 8,  "wk_peak": 10, "wknd_early": 8,  "wknd_peak": 10}'::jsonb WHERE name = '511'                    AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 6,  "wk_peak": 2,  "wknd_early": 2,  "wknd_peak": 2}'::jsonb  WHERE name = 'Boulon'                 AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 4,  "wk_peak": 5,  "wknd_early": 5,  "wknd_peak": 7}'::jsonb  WHERE name = 'Waterstreet'            AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 8,  "wk_peak": 9,  "wknd_early": 9,  "wknd_peak": 10}'::jsonb WHERE name LIKE 'MacDinton%'           AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 7,  "wk_peak": 8,  "wknd_early": 8,  "wknd_peak": 9}'::jsonb  WHERE name = 'The Saloon'             AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 8,  "wk_peak": 9,  "wknd_early": 9,  "wknd_peak": 10}'::jsonb WHERE name = 'The Grove'              AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 6,  "wk_peak": 8,  "wknd_early": 7,  "wknd_peak": 9}'::jsonb  WHERE name = 'Sunset Rodeo'           AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 8,  "wk_peak": 9,  "wknd_early": 9,  "wknd_peak": 10}'::jsonb WHERE name = 'Corner Bar'             AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 13, "wk_peak": 10, "wknd_early": 12, "wknd_peak": 10}'::jsonb WHERE name = 'LALA Tampa'             AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 7,  "wk_peak": 8,  "wknd_early": 8,  "wknd_peak": 10}'::jsonb WHERE name = 'Bad Monkey'             AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 7,  "wk_peak": 8,  "wknd_early": 8,  "wknd_peak": 10}'::jsonb WHERE name = 'The Hub Bar'            AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 2,  "wk_peak": 10, "wknd_early": 2,  "wknd_peak": 10}'::jsonb WHERE name = 'M. Bird'                AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 8,  "wk_peak": 9,  "wknd_early": 9,  "wknd_peak": 10}'::jsonb WHERE name = 'Red Dog'                AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 6,  "wk_peak": 7,  "wknd_early": 6,  "wknd_peak": 7}'::jsonb  WHERE name = 'The Blind Goat'         AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 5,  "wk_peak": 8,  "wknd_early": 5,  "wknd_peak": 8}'::jsonb  WHERE name = 'The Patio'              AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 2,  "wk_peak": 11, "wknd_early": 2,  "wknd_peak": 11}'::jsonb WHERE name = 'Meat Market'            AND city = 'tampa';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 14, "wk_peak": 13, "wknd_early": 1,  "wknd_peak": 13}'::jsonb WHERE name LIKE 'SpookEasy%'           AND city = 'tampa';

-- ST. PETERSBURG
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 13, "wk_peak": 11, "wknd_early": 9,  "wknd_peak": 11}'::jsonb WHERE name = 'Copper Shaker'          AND city = 'st_petersburg';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 8,  "wk_peak": 3,  "wknd_early": 2,  "wknd_peak": 7}'::jsonb  WHERE name = 'Birchwood Canopy'       AND city = 'st_petersburg';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 2,  "wk_peak": 1,  "wknd_early": 9,  "wknd_peak": 10}'::jsonb WHERE name = 'Saigon Blonde'          AND city = 'st_petersburg';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 8,  "wk_peak": 8,  "wknd_early": 8,  "wknd_peak": 8}'::jsonb  WHERE name LIKE 'Five Bucks%'          AND city = 'st_petersburg';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 13, "wk_peak": 12, "wknd_early": 4,  "wknd_peak": 6}'::jsonb  WHERE name = 'Mandarin Hide'          AND city = 'st_petersburg';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 9,  "wk_peak": 10, "wknd_early": 7,  "wknd_peak": 10}'::jsonb WHERE name LIKE 'Welcome to the Farm%' AND city = 'st_petersburg';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 6,  "wk_peak": 4,  "wknd_early": 13, "wknd_peak": 4}'::jsonb  WHERE name LIKE 'Mary Margaret%'       AND city = 'st_petersburg';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 5,  "wk_peak": 2,  "wknd_early": 4,  "wknd_peak": 1}'::jsonb  WHERE name = 'Tryst'                   AND city = 'st_petersburg';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 7,  "wk_peak": 5,  "wknd_early": 7,  "wknd_peak": 5}'::jsonb  WHERE name = 'Oak and Stone'           AND city = 'st_petersburg';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 10, "wk_peak": 9,  "wknd_early": 10, "wknd_peak": 7}'::jsonb  WHERE name LIKE 'Ferg%'                AND city = 'st_petersburg';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 8,  "wk_peak": 3,  "wknd_early": 12, "wknd_peak": 13}'::jsonb WHERE name = 'Crafty Squirrel'        AND city = 'st_petersburg';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 7,  "wk_peak": 9,  "wknd_early": 7,  "wknd_peak": 8}'::jsonb  WHERE name LIKE 'Pour Judgement%'      AND city = 'st_petersburg';
UPDATE public.venues SET vibe_hue_baseline = '{"wk_early": 4,  "wk_peak": 3,  "wknd_early": 2,  "wknd_peak": 3}'::jsonb  WHERE name LIKE 'Cane%Barrel%'         AND city = 'st_petersburg';

-- Detroit 201 left blank intentionally per founders.

-- ─── Verification block (raises notice on completion) ────────────
DO $$
DECLARE
  v_seeded INTEGER;
  v_missing INTEGER;
  v_kn INTEGER; v_tp INTEGER; v_sp INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_seeded FROM public.venues WHERE vibe_hue_baseline IS NOT NULL;
  SELECT COUNT(*) INTO v_missing FROM public.venues WHERE vibe_hue_baseline IS NULL AND is_active = true AND city IN ('knoxville','tampa','st_petersburg');
  SELECT COUNT(*) INTO v_kn FROM public.venues WHERE vibe_hue_baseline IS NOT NULL AND city = 'knoxville';
  SELECT COUNT(*) INTO v_tp FROM public.venues WHERE vibe_hue_baseline IS NOT NULL AND city = 'tampa';
  SELECT COUNT(*) INTO v_sp FROM public.venues WHERE vibe_hue_baseline IS NOT NULL AND city = 'st_petersburg';

  RAISE NOTICE '─────────────────────────────────────';
  RAISE NOTICE 'VIBE FOUNDATION DEPLOYED';
  RAISE NOTICE '  Total venues seeded: %', v_seeded;
  RAISE NOTICE '  Knoxville: %', v_kn;
  RAISE NOTICE '  Tampa: %', v_tp;
  RAISE NOTICE '  St Petersburg: %', v_sp;
  RAISE NOTICE '  Active venues still missing baseline: %', v_missing;
  RAISE NOTICE '─────────────────────────────────────';
END $$;

COMMIT;
