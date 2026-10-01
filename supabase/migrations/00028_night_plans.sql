-- ═══════════════════════════════════════════════════════════════
-- 00028_night_plans.sql
--
-- Venny v1.2 — the plan-maker. Multi-stop night itineraries that
-- the agent composes with Sonnet 4.6 and the user can save, share,
-- and (eventually) activate as a live route on the map.
--
-- Schema notes
--   • user_id  → public.profiles(id) (the venuu profile primary key).
--     RLS bridges via profiles.auth_id = auth.uid(). Guests can
--     compose plans but not save them — the NOT NULL constraint
--     forces save_plan to refuse without an authenticated profile.
--   • conversation_id is nullable + SET NULL on delete so plans
--     survive their originating chat thread getting cleaned up.
--   • stops is JSONB so the row reconstructs the timeline + route
--     line with no extra joins:
--       [{ venue_id, venue_name, lat, lng, arrival_time,
--          duration_min, vibe_note, estimated_cost }, …]
--   • status: 'planned' (just saved) → 'active' (user pressed start
--     and the map is showing the route) → 'completed' | 'abandoned'.
--   • share_token is a public read handle for v1.3 shareable URLs.
--     Anonymous reads are allowed only when the token exists.
--
-- Wrapped in BEGIN/COMMIT, idempotent.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- night_plans
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.night_plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  conversation_id       uuid REFERENCES public.venny_conversations(id) ON DELETE SET NULL,
  city                  text NOT NULL,
  title                 text NOT NULL,
  summary               text,
  stops                 jsonb NOT NULL,
  total_estimated_cost  integer,        -- per person, USD (whole dollars)
  total_duration_min    integer,
  start_time            text,           -- "8:30 PM" — human-format, agent-emitted
  end_time              text,
  group_size            integer,
  vibe_tags             jsonb,          -- array of tags the plan was built around
  status                text NOT NULL DEFAULT 'planned'
                          CHECK (status IN ('planned', 'active', 'completed', 'abandoned')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  activated_at          timestamptz,
  completed_at          timestamptz,
  share_token           text UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_night_plans_user_created
  ON public.night_plans (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_night_plans_status_open
  ON public.night_plans (status)
  WHERE status IN ('planned', 'active');

CREATE INDEX IF NOT EXISTS idx_night_plans_share_token
  ON public.night_plans (share_token)
  WHERE share_token IS NOT NULL;

ALTER TABLE public.night_plans ENABLE ROW LEVEL SECURITY;

-- ── Owner can do everything on their own plans ───────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='night_plans' AND policyname='night_plans_owner'
  ) THEN
    CREATE POLICY "night_plans_owner"
      ON public.night_plans
      FOR ALL
      TO authenticated
      USING (
        auth.uid()::text = (
          SELECT auth_id::text FROM public.profiles WHERE id = night_plans.user_id
        )
      )
      WITH CHECK (
        auth.uid()::text = (
          SELECT auth_id::text FROM public.profiles WHERE id = night_plans.user_id
        )
      );
  END IF;
END $$;

-- ── Anyone (anon or authenticated) can read shared plans ─────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='night_plans' AND policyname='night_plans_public_share'
  ) THEN
    CREATE POLICY "night_plans_public_share"
      ON public.night_plans
      FOR SELECT
      TO anon, authenticated
      USING (share_token IS NOT NULL);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.night_plans TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- Verify
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  plans_ok boolean;
  pol_n    int;
  idx_n    int;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='night_plans') INTO plans_ok;
  SELECT COUNT(*) INTO pol_n FROM pg_policies
    WHERE schemaname='public' AND tablename='night_plans';
  SELECT COUNT(*) INTO idx_n FROM pg_indexes
    WHERE schemaname='public' AND tablename='night_plans';

  RAISE NOTICE '═══ Migration 00028 complete ═══';
  RAISE NOTICE '  night_plans:            %', CASE WHEN plans_ok THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  RLS policies installed: %', pol_n;
  RAISE NOTICE '  Indexes:                %', idx_n;
END $$;

COMMIT;
