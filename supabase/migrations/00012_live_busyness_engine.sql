-- ═══════════════════════════════════════════════════════════════
-- 00012_live_busyness_engine.sql
-- Live BestTime busyness collection schema:
--   - denormalized live columns on venues (fast map reads)
--   - besttime_live_snapshots (append-only history for forensics + ML)
--   - besttime_collections (one collection_id per city, lets us
--     refresh all venues in a city in ONE BestTime API call)
--   - 3 new signal_weights rows for the prediction-engine fusion fn
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- venues: denormalized live busyness columns (read-hot, write-warm)
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS live_busyness_pct integer,
  ADD COLUMN IF NOT EXISTS live_busyness_vs_forecast integer,
  ADD COLUMN IF NOT EXISTS live_busyness_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS besttime_collection_id text;

COMMENT ON COLUMN public.venues.live_busyness_pct IS
  'Most recent BestTime live busyness 0-100. Refreshed by the live cron.';
COMMENT ON COLUMN public.venues.live_busyness_vs_forecast IS
  'Signed delta: live - forecasted. Positive = surge, negative = dud.';
COMMENT ON COLUMN public.venues.besttime_collection_id IS
  'BestTime collection this venue is registered with — set by setup-besttime-collections.cjs.';

-- ───────────────────────────────────────────────────────────────
-- besttime_live_snapshots: append-only history of every live pull
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.besttime_live_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT now(),
  forecasted_busyness integer,
  live_busyness integer,
  delta integer,
  venue_open text,
  hour_start integer,
  raw_response jsonb
);

CREATE INDEX IF NOT EXISTS idx_besttime_snapshots_venue_time
  ON public.besttime_live_snapshots (venue_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_besttime_snapshots_time
  ON public.besttime_live_snapshots (captured_at DESC);

ALTER TABLE public.besttime_live_snapshots ENABLE ROW LEVEL SECURITY;
-- No policies = anon/authenticated get nothing; service_role bypasses RLS.

-- ───────────────────────────────────────────────────────────────
-- besttime_collections: one row per city, holds the collection_id
-- so future refreshes hit one endpoint per city instead of N
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.besttime_collections (
  city text PRIMARY KEY,
  collection_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  venue_count integer DEFAULT 0,
  last_synced_at timestamptz
);

ALTER TABLE public.besttime_collections ENABLE ROW LEVEL SECURITY;
-- No policies = anon/authenticated get nothing; service_role bypasses RLS.

-- ───────────────────────────────────────────────────────────────
-- signal_weights: 3 new BestTime signal types
-- ttl values converted from minutes (per spec) to seconds (table column)
-- ───────────────────────────────────────────────────────────────
INSERT INTO public.signal_weights (signal_type, weight, ttl_seconds, description) VALUES
  ('besttime_forecast_now', 0.50, 5400, 'BestTime forecasted busyness for the current hour. Baseline component, refreshed every 30 min.'),
  ('besttime_live',         0.70, 5400, 'BestTime live busyness for the current hour. Real-time observation derived from device signals.'),
  ('besttime_anomaly',      0.85, 3600, 'BestTime live-vs-forecast delta with |delta| >= 30. Strong directional signal: surge or dud.')
ON CONFLICT (signal_type) DO UPDATE SET
  weight       = EXCLUDED.weight,
  ttl_seconds  = EXCLUDED.ttl_seconds,
  description  = EXCLUDED.description,
  updated_at   = now();

-- ───────────────────────────────────────────────────────────────
-- Verify
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  snap_table_ok boolean;
  coll_table_ok boolean;
  signal_count int;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'besttime_live_snapshots'
  ) INTO snap_table_ok;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'besttime_collections'
  ) INTO coll_table_ok;

  SELECT COUNT(*) INTO signal_count
  FROM public.signal_weights
  WHERE signal_type IN ('besttime_forecast_now', 'besttime_live', 'besttime_anomaly');

  RAISE NOTICE '═══ Migration 00012 complete ═══';
  RAISE NOTICE '  besttime_live_snapshots table: %', CASE WHEN snap_table_ok THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  besttime_collections table:    %', CASE WHEN coll_table_ok THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  besttime signal_weights rows:  % / 3 expected', signal_count;
  RAISE NOTICE '  venues columns added: live_busyness_pct, live_busyness_vs_forecast, live_busyness_updated_at, besttime_collection_id';
END $$;

COMMIT;
