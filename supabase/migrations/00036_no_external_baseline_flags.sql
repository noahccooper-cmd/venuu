BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- Phase 0: flag venues with no external baseline data.
--
-- These venues fall into the baseline cascade's "no_external_baseline"
-- bucket. The fuse engine treats them identically (category_default_pct
-- until live user signals arrive in Phase 1). The data_quality flag is
-- so we can distinguish "we tried and BestTime can't help" from "we
-- haven't tried yet" — important for ops dashboards and Phase 1 sizing.
--
-- Three sources of no_external_baseline:
--   1. Jannus Live (st_petersburg) — events venue, not a bar. Show-driven
--      foot traffic doesn't fit forecast curves. Belongs in events product.
--   2. The Bookstore (knoxville) — BestTime "could not find venue".
--      Address verified correct; BestTime simply has no index entry.
--   3. 15 venues across Knoxville/Tampa/St. Petersburg where BestTime
--      returned "Venue found, but could not forecast" — insufficient
--      visitor volume in BestTime's data to build a forecast.
--
-- Engine impact: these venues will use category_default_pct as baseline
-- until Phase 1 user signals (direction_request, geofence enter, plan
-- intent, bouncer override) provide live data points.
-- ─────────────────────────────────────────────────────────────────────

-- 1. Jannus Live — events venue exclusion
INSERT INTO public.venue_baselines (venue_id, data_quality, notes, updated_at)
SELECT id, 'no_external_baseline',
       'Events venue. BestTime forecast curves do not fit show-driven foot traffic. Handle in events product layer.',
       now()
FROM public.venues
WHERE name = 'Jannus Live' AND city = 'st_petersburg'
ON CONFLICT (venue_id) DO UPDATE SET
  data_quality = 'no_external_baseline',
  notes = EXCLUDED.notes,
  updated_at = now();

-- 2. The Bookstore — BestTime "could not find venue"
INSERT INTO public.venue_baselines (venue_id, data_quality, notes, updated_at)
SELECT id, 'no_external_baseline',
       'New venue, popular locally, BestTime has no foot-traffic history yet. Phase 1 user signals (direction_request, geofence, plan_intent) will provide live data.',
       now()
FROM public.venues
WHERE name = 'The Bookstore' AND city = 'knoxville'
ON CONFLICT (venue_id) DO UPDATE SET
  data_quality = 'no_external_baseline',
  notes = EXCLUDED.notes,
  updated_at = now();

-- 3. Knoxville venues — BestTime "found but insufficient volume"
INSERT INTO public.venue_baselines (venue_id, data_quality, notes, updated_at)
SELECT id, 'no_external_baseline',
       'BestTime found the venue but cannot forecast: insufficient visitor volume in their data. Phase 1 user signals required.',
       now()
FROM public.venues
WHERE city = 'knoxville'
  AND name IN ('Yacht Club', 'Hannas', 'LunaVerse', 'LiterBoard', 'Undeclared')
ON CONFLICT (venue_id) DO UPDATE SET
  data_quality = 'no_external_baseline',
  notes = EXCLUDED.notes,
  updated_at = now();

-- 4. St. Petersburg venues — BestTime "found but insufficient volume"
INSERT INTO public.venue_baselines (venue_id, data_quality, notes, updated_at)
SELECT id, 'no_external_baseline',
       'BestTime found the venue but cannot forecast: insufficient visitor volume in their data. Phase 1 user signals required.',
       now()
FROM public.venues
WHERE city = 'st_petersburg'
  AND name IN ('Teak at The Pier', 'Trailer Daddy', 'Sparrow')
ON CONFLICT (venue_id) DO UPDATE SET
  data_quality = 'no_external_baseline',
  notes = EXCLUDED.notes,
  updated_at = now();

-- 5. Tampa venues — BestTime "found but insufficient volume"
INSERT INTO public.venue_baselines (venue_id, data_quality, notes, updated_at)
SELECT id, 'no_external_baseline',
       'BestTime found the venue but cannot forecast: insufficient visitor volume in their data. Phase 1 user signals required.',
       now()
FROM public.venues
WHERE city = 'tampa'
  AND name IN ('Grove Soho', 'M. Bird', 'American Social', 'Echo', 'Waterstreet', 'The Saloon', 'The Grove')
ON CONFLICT (venue_id) DO UPDATE SET
  data_quality = 'no_external_baseline',
  notes = EXCLUDED.notes,
  updated_at = now();

DO $$
DECLARE
  flagged_count INT;
BEGIN
  SELECT COUNT(*) INTO flagged_count
  FROM public.venue_baselines
  WHERE data_quality = 'no_external_baseline';

  RAISE NOTICE '─────────────────────────────────────';
  RAISE NOTICE 'Phase 0 baseline flags applied';
  RAISE NOTICE 'Total no_external_baseline rows: %', flagged_count;
  RAISE NOTICE '  - Jannus Live (events venue)';
  RAISE NOTICE '  - The Bookstore (not in BestTime index)';
  RAISE NOTICE '  - 5 Knoxville venues (insufficient BestTime volume)';
  RAISE NOTICE '  - 3 St. Petersburg venues (insufficient BestTime volume)';
  RAISE NOTICE '  - 7 Tampa venues (insufficient BestTime volume)';
  RAISE NOTICE '─────────────────────────────────────';
END $$;

COMMIT;
