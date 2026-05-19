-- ═══════════════════════════════════════════════════════════════
-- 00033_plan_execution.sql
--
-- Plan Execution Mode — the moment a saved night_plan becomes a
-- live, time-aware companion. Adds two columns to night_plans
-- (activated_at was added in 00028 but kept here idempotent) plus
-- an index for the "active right now" lookup.
--
-- Per-stop execution state lives inside the stops JSONB. No schema
-- change needed there — the client UPSERTs new fields onto each
-- stop object as the user advances through the night:
--   arrived_at          timestamptz   — set when this stop is checked-in,
--                                       either by tap or proximity
--   skipped_at          timestamptz   — set when the user hold-skips
--   completed_at        timestamptz   — set on the final stop when
--                                       the user taps "end the night"
--   confirmed_manually  boolean       — true if arrival was a tap,
--                                       false if proximity detector
--                                       auto-credited the visit
--   left_at             timestamptz   — set when the user moves past
--                                       this stop to the next one
--   visited_at          (legacy)      — older client wrote this; new
--                                       client treats it as arrived_at
--                                       when arrived_at is absent
--
-- Idempotent. Wrapped in BEGIN/COMMIT. Re-running is safe.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- A) Schema additions
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.night_plans ADD COLUMN IF NOT EXISTS activated_at       TIMESTAMPTZ;
ALTER TABLE public.night_plans ADD COLUMN IF NOT EXISTS current_stop_index INTEGER DEFAULT 0;


-- ───────────────────────────────────────────────────────────────
-- B) Status CHECK constraint — verify 'active' is allowed.
--    Migration 00028 already includes it; this block is a safety
--    net in case some hand-fixed env drifted.
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  has_active_check boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'night_plans'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%active%'
  ) INTO has_active_check;

  IF NOT has_active_check THEN
    -- Drop whatever 'status'-named check exists, then re-add the
    -- canonical four-state version.
    EXECUTE (
      SELECT format('ALTER TABLE public.night_plans DROP CONSTRAINT %I', c.conname)
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'night_plans'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) ILIKE '%status%'
      LIMIT 1
    );
    ALTER TABLE public.night_plans
      ADD CONSTRAINT night_plans_status_check
      CHECK (status IN ('planned', 'active', 'completed', 'abandoned'));
  END IF;
END $$;


-- ───────────────────────────────────────────────────────────────
-- C) Index for "currently-active plan for this user"
-- ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_night_plans_active
  ON public.night_plans (user_id, activated_at DESC)
  WHERE status = 'active';


-- ───────────────────────────────────────────────────────────────
-- D) Verification
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  has_activated   boolean;
  has_csi         boolean;
  has_idx         boolean;
  c_planned       integer;
  c_active        integer;
  c_completed     integer;
  c_abandoned     integer;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='night_plans' AND column_name='activated_at'
  ) INTO has_activated;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='night_plans' AND column_name='current_stop_index'
  ) INTO has_csi;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='idx_night_plans_active'
  ) INTO has_idx;

  SELECT COUNT(*) INTO c_planned    FROM public.night_plans WHERE status = 'planned';
  SELECT COUNT(*) INTO c_active     FROM public.night_plans WHERE status = 'active';
  SELECT COUNT(*) INTO c_completed  FROM public.night_plans WHERE status = 'completed';
  SELECT COUNT(*) INTO c_abandoned  FROM public.night_plans WHERE status = 'abandoned';

  RAISE NOTICE '────────────────────────────────────────';
  RAISE NOTICE 'Plan Execution Migration Results';
  RAISE NOTICE '────────────────────────────────────────';
  RAISE NOTICE 'activated_at column:        %', CASE WHEN has_activated THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE 'current_stop_index column:  %', CASE WHEN has_csi       THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE 'idx_night_plans_active:     %', CASE WHEN has_idx       THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE 'Plans by status — planned:    %', c_planned;
  RAISE NOTICE '                  active:     %', c_active;
  RAISE NOTICE '                  completed:  %', c_completed;
  RAISE NOTICE '                  abandoned:  %', c_abandoned;
  RAISE NOTICE '────────────────────────────────────────';
  RAISE NOTICE 'EXECUTION READY: PlanExecutionPage can mount';
  RAISE NOTICE '────────────────────────────────────────';
END $$;

COMMIT;
