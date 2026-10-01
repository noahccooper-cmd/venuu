-- ═══════════════════════════════════════════════════════════════
-- 00034_night_ratings.sql
--
-- Rate Your Night v1 — substrate for the post-plan rating flow.
--
--   • stop_ratings   — one row per (user, plan, stop_index). Rating
--                      is loved / fine / meh. Drives the profile's
--                      Taste % stat and feeds Venny's future memory
--                      layer (Prompt 2 wires the read path).
--   • night_ratings  — one row per (user, plan). Carries overall
--                      vibe, mood_tags array, would_repeat boolean,
--                      and an optional free-text notes field for
--                      future use.
--   • night_plans.rating_status — pointer column the morning-push
--                      cron will scan for `pending_morning`.
--
-- Idempotent. Wrapped in BEGIN/COMMIT. Re-running is safe.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- A) stop_ratings — one row per visited stop the user rated.
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stop_ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id     UUID NOT NULL REFERENCES public.night_plans(id) ON DELETE CASCADE,
  stop_index  INTEGER NOT NULL,
  venue_id    UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  rating      TEXT NOT NULL CHECK (rating IN ('loved', 'fine', 'meh')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stop_ratings_unique UNIQUE (user_id, plan_id, stop_index)
);

CREATE INDEX IF NOT EXISTS idx_stop_ratings_user
  ON public.stop_ratings (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stop_ratings_venue
  ON public.stop_ratings (venue_id);
CREATE INDEX IF NOT EXISTS idx_stop_ratings_plan
  ON public.stop_ratings (plan_id);

ALTER TABLE public.stop_ratings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='stop_ratings' AND policyname='stop_ratings_owner_select'
  ) THEN
    CREATE POLICY "stop_ratings_owner_select" ON public.stop_ratings
      FOR SELECT TO authenticated
      USING (user_id IN (SELECT id FROM public.profiles WHERE auth_id = auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='stop_ratings' AND policyname='stop_ratings_owner_insert'
  ) THEN
    CREATE POLICY "stop_ratings_owner_insert" ON public.stop_ratings
      FOR INSERT TO authenticated
      WITH CHECK (user_id IN (SELECT id FROM public.profiles WHERE auth_id = auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='stop_ratings' AND policyname='stop_ratings_owner_update'
  ) THEN
    CREATE POLICY "stop_ratings_owner_update" ON public.stop_ratings
      FOR UPDATE TO authenticated
      USING (user_id IN (SELECT id FROM public.profiles WHERE auth_id = auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='stop_ratings' AND policyname='stop_ratings_owner_delete'
  ) THEN
    CREATE POLICY "stop_ratings_owner_delete" ON public.stop_ratings
      FOR DELETE TO authenticated
      USING (user_id IN (SELECT id FROM public.profiles WHERE auth_id = auth.uid()));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stop_ratings TO authenticated;


-- ───────────────────────────────────────────────────────────────
-- B) night_ratings — one row per rated plan.
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.night_ratings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id         UUID NOT NULL UNIQUE REFERENCES public.night_plans(id) ON DELETE CASCADE,
  overall_rating  TEXT NOT NULL CHECK (
                    overall_rating IN ('best_in_weeks', 'great', 'good', 'meh', 'bad')
                  ),
  mood_tags       TEXT[] NOT NULL DEFAULT '{}',
  would_repeat    BOOLEAN,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_night_ratings_user
  ON public.night_ratings (user_id, created_at DESC);

ALTER TABLE public.night_ratings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='night_ratings' AND policyname='night_ratings_owner_select'
  ) THEN
    CREATE POLICY "night_ratings_owner_select" ON public.night_ratings
      FOR SELECT TO authenticated
      USING (user_id IN (SELECT id FROM public.profiles WHERE auth_id = auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='night_ratings' AND policyname='night_ratings_owner_insert'
  ) THEN
    CREATE POLICY "night_ratings_owner_insert" ON public.night_ratings
      FOR INSERT TO authenticated
      WITH CHECK (user_id IN (SELECT id FROM public.profiles WHERE auth_id = auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='night_ratings' AND policyname='night_ratings_owner_update'
  ) THEN
    CREATE POLICY "night_ratings_owner_update" ON public.night_ratings
      FOR UPDATE TO authenticated
      USING (user_id IN (SELECT id FROM public.profiles WHERE auth_id = auth.uid()));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.night_ratings TO authenticated;


-- ───────────────────────────────────────────────────────────────
-- C) night_plans.rating_status — pointer for the morning push cron.
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.night_plans
  ADD COLUMN IF NOT EXISTS rating_status TEXT DEFAULT 'unrated';

-- CHECK constraint added separately so we can drop+re-add safely
-- when re-running on an env that already has a partial column.
DO $$
DECLARE
  has_check BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'night_plans'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%rating_status%'
  ) INTO has_check;
  IF NOT has_check THEN
    ALTER TABLE public.night_plans
      ADD CONSTRAINT night_plans_rating_status_check
      CHECK (rating_status IN ('unrated', 'pending_morning', 'rated', 'skipped'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_night_plans_pending_rating
  ON public.night_plans (rating_status, completed_at)
  WHERE rating_status = 'pending_morning';


-- ───────────────────────────────────────────────────────────────
-- D) Verification
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_stop_ratings_count   INTEGER;
  v_night_ratings_count  INTEGER;
  v_rating_status_exists BOOLEAN;
  v_pending_idx_exists   BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_stop_ratings_count FROM public.stop_ratings;
  SELECT COUNT(*) INTO v_night_ratings_count FROM public.night_ratings;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='night_plans' AND column_name='rating_status'
  ) INTO v_rating_status_exists;
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='idx_night_plans_pending_rating'
  ) INTO v_pending_idx_exists;

  RAISE NOTICE '─────────────────────────────────────';
  RAISE NOTICE 'Rate Your Night Migration Results';
  RAISE NOTICE '─────────────────────────────────────';
  RAISE NOTICE 'stop_ratings table:           ready (% rows)', v_stop_ratings_count;
  RAISE NOTICE 'night_ratings table:          ready (% rows)', v_night_ratings_count;
  RAISE NOTICE 'night_plans.rating_status:    %', CASE WHEN v_rating_status_exists THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE 'idx pending_morning rating:   %', CASE WHEN v_pending_idx_exists   THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '─────────────────────────────────────';
  RAISE NOTICE 'READY: rating flow can mount';
  RAISE NOTICE '─────────────────────────────────────';
END $$;

COMMIT;
