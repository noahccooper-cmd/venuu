-- ═══════════════════════════════════════════════════════════════
-- 00030_passive_presence.sql
--
-- Adds passive presence detection. Two new tables:
--
--   • presence_events — high-volume raw stream of "user near venue"
--     pings, one row per (enter | still_present | exit) crossing.
--   • user_visits    — confirmed-visit aggregate. ONE row per
--     (user, venue, night_of). Source of truth for the "Nights Out"
--     and "Venues Discovered" stats on the profile.
--
-- loyalty_visits stays — it's the NFC-tap source of truth for
-- rewards/punch-card progress. We just stop conflating "any night
-- out" with "did I tap an NFC tag tonight".
--
-- The user_account_stats view is repointed to read from user_visits,
-- and a new `loyalty_bars_count` column is added for the renamed
-- "My Rewards" section on the profile.
--
-- Backfill grandfathers existing users from loyalty_visits, completed
-- cover_purchases, and the stops inside completed night_plans, so
-- nobody loses progress when the new system goes live.
--
-- Wrapped in BEGIN/COMMIT, idempotent (IF NOT EXISTS + ON CONFLICT).
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- A) presence_events
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.presence_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  venue_id    uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  event_type  text NOT NULL CHECK (event_type IN ('enter','still_present','exit')),
  distance_m  integer NOT NULL,
  accuracy_m  integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_presence_events_user_created
  ON public.presence_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_presence_events_user_venue_created
  ON public.presence_events (user_id, venue_id, created_at DESC);

-- ───────────────────────────────────────────────────────────────
-- B) user_visits — confirmed (user, venue, night_of) triples
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_visits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  venue_id        uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  night_of        date NOT NULL,
  first_seen_at   timestamptz NOT NULL,
  last_seen_at    timestamptz NOT NULL,
  duration_min    integer,                                 -- capped at 480 (8h) by client
  source          text NOT NULL CHECK (source IN ('passive','nfc','cover','plan_stop','manual')),
  confidence      integer NOT NULL DEFAULT 100 CHECK (confidence BETWEEN 0 AND 100),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_visits_unique UNIQUE (user_id, venue_id, night_of)
);

CREATE INDEX IF NOT EXISTS idx_user_visits_user_night
  ON public.user_visits (user_id, night_of DESC);

CREATE INDEX IF NOT EXISTS idx_user_visits_user_venue
  ON public.user_visits (user_id, venue_id);

CREATE INDEX IF NOT EXISTS idx_user_visits_passive
  ON public.user_visits (venue_id, night_of)
  WHERE source = 'passive';

COMMENT ON TABLE public.user_visits IS
  'Confirmed visits. Source of truth for "Venues Discovered" and "Nights Out". '
  'Populated by passive geolocation + NFC + covers + completed plans. '
  'Distinct from loyalty_visits which tracks NFC-only for rewards.';

-- ───────────────────────────────────────────────────────────────
-- C) RLS — presence_events (owner SELECT + INSERT, service-role anything)
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.presence_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='presence_events'
       AND policyname='presence_events_owner_select'
  ) THEN
    CREATE POLICY "presence_events_owner_select"
      ON public.presence_events FOR SELECT TO authenticated
      USING (
        auth.uid()::text = (
          SELECT auth_id::text FROM public.profiles WHERE id = presence_events.user_id
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='presence_events'
       AND policyname='presence_events_owner_insert'
  ) THEN
    CREATE POLICY "presence_events_owner_insert"
      ON public.presence_events FOR INSERT TO authenticated
      WITH CHECK (
        auth.uid()::text = (
          SELECT auth_id::text FROM public.profiles WHERE id = presence_events.user_id
        )
      );
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────
-- D) RLS — user_visits (owner SELECT + INSERT/UPDATE, future friends placeholder)
--    Promoted visits are written by the client (the proximity detector
--    runs there); the INSERT/UPDATE policy gates that path by profile
--    ownership. A future Ship 3 friends-visibility policy lives in a
--    comment until the friend-relationship table exists.
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.user_visits ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='user_visits'
       AND policyname='user_visits_owner_select'
  ) THEN
    CREATE POLICY "user_visits_owner_select"
      ON public.user_visits FOR SELECT TO authenticated
      USING (
        auth.uid()::text = (
          SELECT auth_id::text FROM public.profiles WHERE id = user_visits.user_id
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='user_visits'
       AND policyname='user_visits_owner_write'
  ) THEN
    CREATE POLICY "user_visits_owner_write"
      ON public.user_visits FOR INSERT TO authenticated
      WITH CHECK (
        auth.uid()::text = (
          SELECT auth_id::text FROM public.profiles WHERE id = user_visits.user_id
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='user_visits'
       AND policyname='user_visits_owner_update'
  ) THEN
    CREATE POLICY "user_visits_owner_update"
      ON public.user_visits FOR UPDATE TO authenticated
      USING (
        auth.uid()::text = (
          SELECT auth_id::text FROM public.profiles WHERE id = user_visits.user_id
        )
      )
      WITH CHECK (
        auth.uid()::text = (
          SELECT auth_id::text FROM public.profiles WHERE id = user_visits.user_id
        )
      );
  END IF;
END $$;

-- Ship 3 placeholder — once a friends/user_relationships table exists,
-- a policy can be added here that grants SELECT to friends of the row
-- owner when profiles.show_visits_publicly is true. Intentionally not
-- written yet so nobody can see other users' visits in Ship 2.

-- ───────────────────────────────────────────────────────────────
-- E) Backfill from existing sources. Use a temp counter table so
--    the verify block at the bottom can report row counts per source.
-- ───────────────────────────────────────────────────────────────
CREATE TEMP TABLE _backfill_counts (source text PRIMARY KEY, n int);

-- 1. Backfill from loyalty_visits (NFC taps).
-- loyalty_visits schema: verified_at is the NFC tap timestamp,
-- night_of is already computed. Skip rows missing verified_at so
-- first_seen_at / last_seen_at stay NOT NULL on user_visits.
WITH inserted AS (
  INSERT INTO public.user_visits
    (user_id, venue_id, night_of, first_seen_at, last_seen_at, source)
  SELECT
    p.id, lv.venue_id, lv.night_of, lv.verified_at, lv.verified_at, 'nfc'
  FROM public.loyalty_visits lv
  JOIN public.profiles p ON p.auth_id = lv.user_id
  WHERE lv.verified_at IS NOT NULL
  ON CONFLICT (user_id, venue_id, night_of) DO NOTHING
  RETURNING 1
)
INSERT INTO _backfill_counts (source, n)
SELECT 'nfc', COUNT(*) FROM inserted;

WITH inserted AS (
  INSERT INTO public.user_visits
    (user_id, venue_id, night_of, first_seen_at, last_seen_at, source)
  SELECT
    p.id, cp.venue_id,
    CASE WHEN EXTRACT(HOUR FROM cp.purchased_at) < 8
         THEN (cp.purchased_at - INTERVAL '1 day')::date
         ELSE cp.purchased_at::date END,
    cp.purchased_at, cp.purchased_at, 'cover'
  FROM public.cover_purchases cp
  JOIN public.profiles p ON p.auth_id = cp.user_id
  WHERE cp.status IN ('completed','used')
  ON CONFLICT (user_id, venue_id, night_of) DO NOTHING
  RETURNING 1
)
INSERT INTO _backfill_counts (source, n)
SELECT 'cover', COUNT(*) FROM inserted;

WITH inserted AS (
  INSERT INTO public.user_visits
    (user_id, venue_id, night_of, first_seen_at, last_seen_at, source)
  SELECT
    np.user_id,
    (stop->>'venue_id')::uuid,
    CASE WHEN EXTRACT(HOUR FROM np.completed_at) < 8
         THEN (np.completed_at - INTERVAL '1 day')::date
         ELSE np.completed_at::date END,
    np.completed_at, np.completed_at, 'plan_stop'
  FROM public.night_plans np,
       LATERAL jsonb_array_elements(np.stops) AS stop
  WHERE np.status = 'completed'
    AND np.completed_at IS NOT NULL
    AND (stop->>'venue_id') IS NOT NULL
  ON CONFLICT (user_id, venue_id, night_of) DO NOTHING
  RETURNING 1
)
INSERT INTO _backfill_counts (source, n)
SELECT 'plan_stop', COUNT(*) FROM inserted;

-- ───────────────────────────────────────────────────────────────
-- F) Repointed user_account_stats view
--    Nights Out + Venues Discovered now read from user_visits;
--    loyalty_redemptions still drives total_rewards; new
--    loyalty_bars_count drives "My Rewards" section header subtitle.
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.user_account_stats AS
SELECT
  p.id        AS profile_id,
  p.auth_id   AS auth_id,
  p.username  AS username,
  COALESCE((
    SELECT COUNT(DISTINCT night_of)
      FROM public.user_visits uv
     WHERE uv.user_id = p.id
  ), 0)::int AS nights_out,
  COALESCE((
    SELECT COUNT(DISTINCT venue_id)
      FROM public.user_visits uv
     WHERE uv.user_id = p.id
  ), 0)::int AS venues_discovered,
  COALESCE((
    SELECT COUNT(*) FROM public.venue_recaps WHERE username = p.username
  ), 0)::int AS total_recaps,
  COALESCE((
    SELECT (COUNT(*) FILTER (WHERE stars >= 4)::numeric * 100
            / NULLIF(COUNT(*), 0))::int
      FROM public.venue_recaps WHERE username = p.username
  ), 0)::int AS taste_accuracy_pct,
  COALESCE((
    SELECT COUNT(*) FROM public.night_plans WHERE user_id = p.id
  ), 0)::int AS total_plans,
  COALESCE((
    SELECT COUNT(*) FROM public.night_plans
     WHERE user_id = p.id AND status = 'completed'
  ), 0)::int AS plans_completed,
  COALESCE((
    SELECT COUNT(*) FROM public.loyalty_redemptions
     WHERE user_id = p.auth_id
  ), 0)::int AS total_rewards,
  COALESCE((
    SELECT COUNT(DISTINCT venue_id) FROM public.loyalty_visits
     WHERE user_id = p.auth_id
  ), 0)::int AS loyalty_bars_count
FROM public.profiles p;

-- ───────────────────────────────────────────────────────────────
-- G) Grants
-- ───────────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON public.presence_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_visits TO authenticated;
GRANT SELECT ON public.user_account_stats TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- Verify
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  pres_ok    boolean;
  visits_ok  boolean;
  view_ok    boolean;
  n_nfc      int;
  n_cover    int;
  n_plan     int;
  total_uv   int;
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='presence_events') INTO pres_ok;
  SELECT EXISTS(SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='user_visits') INTO visits_ok;
  SELECT EXISTS(SELECT 1 FROM information_schema.views
    WHERE table_schema='public' AND table_name='user_account_stats') INTO view_ok;

  SELECT COALESCE((SELECT n FROM _backfill_counts WHERE source='nfc'), 0)       INTO n_nfc;
  SELECT COALESCE((SELECT n FROM _backfill_counts WHERE source='cover'), 0)     INTO n_cover;
  SELECT COALESCE((SELECT n FROM _backfill_counts WHERE source='plan_stop'), 0) INTO n_plan;
  SELECT COUNT(*) FROM public.user_visits INTO total_uv;

  RAISE NOTICE '═══ Migration 00030 complete ═══';
  RAISE NOTICE '  presence_events:        %', CASE WHEN pres_ok   THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  user_visits:            %', CASE WHEN visits_ok THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  user_account_stats:     %', CASE WHEN view_ok   THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  Backfill from nfc:       %', n_nfc;
  RAISE NOTICE '  Backfill from cover:     %', n_cover;
  RAISE NOTICE '  Backfill from plan_stop: %', n_plan;
  RAISE NOTICE '  Total user_visits rows:  %', total_uv;
END $$;

COMMIT;
