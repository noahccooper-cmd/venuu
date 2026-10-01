-- ═══════════════════════════════════════════════════════════════
-- 00009_add_besttime_venue_id.sql
-- Stores BestTime's venue_id so future refreshes use the cheap
-- 1-credit query endpoint instead of the 2-credit forecast endpoint.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS besttime_venue_id text;

CREATE INDEX IF NOT EXISTS idx_venues_besttime_id
  ON public.venues (besttime_venue_id)
  WHERE besttime_venue_id IS NOT NULL;

COMMENT ON COLUMN public.venues.besttime_venue_id IS
  'BestTime.app venue_id — set after first forecast pull. Used for cheap query refreshes.';
