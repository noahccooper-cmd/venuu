-- ═══════════════════════════════════════════════════════════════
-- 00026_globe_snapshots.sql
--
-- Append-only log of every "share globe" tap. Powers per-user
-- analytics today and a public landing-page surface tomorrow:
-- the cities_snapshot JSONB freezes the full CityAggregate state
-- so a future /share/<id> route can render the exact moment the
-- user shared without re-querying the prediction engine.
--
-- user_id is FK'd to auth.users — App.tsx forwards `user.id`
-- (the Supabase auth uid) into the hook, which matches auth.uid()
-- in the RLS policy. Guests insert with user_id = NULL.
--
-- Idempotent. Wrapped in BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.globe_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  total_people_out integer NOT NULL,
  city_count integer NOT NULL,
  cities_snapshot jsonb NOT NULL,
  caption text,
  shared_to text
);

CREATE INDEX IF NOT EXISTS globe_snapshots_created_at_idx
  ON public.globe_snapshots (created_at DESC);

CREATE INDEX IF NOT EXISTS globe_snapshots_user_id_idx
  ON public.globe_snapshots (user_id)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.globe_snapshots ENABLE ROW LEVEL SECURITY;

-- Authenticated users may insert rows where user_id is their own
-- auth uid OR null (counts as a guest snapshot from a logged-in user
-- who chose not to attribute it).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'globe_snapshots'
      AND policyname = 'Users can insert their own snapshots'
  ) THEN
    CREATE POLICY "Users can insert their own snapshots"
      ON public.globe_snapshots FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
  END IF;
END $$;

-- Anonymous users (guest mode) may insert only with NULL user_id.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'globe_snapshots'
      AND policyname = 'Anonymous can insert guest snapshots'
  ) THEN
    CREATE POLICY "Anonymous can insert guest snapshots"
      ON public.globe_snapshots FOR INSERT TO anon
      WITH CHECK (user_id IS NULL);
  END IF;
END $$;

-- Public read — powers future /share/<id> landing pages without auth.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'globe_snapshots'
      AND policyname = 'Public read snapshots'
  ) THEN
    CREATE POLICY "Public read snapshots"
      ON public.globe_snapshots FOR SELECT TO anon, authenticated
      USING (true);
  END IF;
END $$;

GRANT INSERT, SELECT ON public.globe_snapshots TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

DO $$
DECLARE
  table_ok boolean;
  policy_count int;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'globe_snapshots'
  ) INTO table_ok;
  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'globe_snapshots';

  RAISE NOTICE '═══ Migration 00026 complete ═══';
  RAISE NOTICE '  globe_snapshots table: %', CASE WHEN table_ok THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  RLS policies installed: % / 3', policy_count;
END $$;

COMMIT;
