-- ═══════════════════════════════════════════════════════════════
-- 00018_estimates_history.sql
--
-- Append-only history of headcount_estimates so we never lose a
-- fusion cycle. The live table is overwritten every minute by
-- fuse_all_active_venues; this captures every (INSERT or UPDATE)
-- snapshot for forensics, trend analysis, and ML backtests.
--
-- Schema mirror via LIKE so future column adds on the live table
-- only require: ALTER TABLE headcount_estimates_history ADD COLUMN
-- (and updating the trigger column list).
--
-- Idempotent. Wrapped in BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- History table — same columns as headcount_estimates, plus its own
-- surrogate primary key. NOT NULL + CHECK constraints are inherited
-- via INCLUDING CONSTRAINTS; the parent's PK on venue_id is NOT
-- inherited (LIKE never copies primary key/unique indexes), which
-- is exactly what we want — many rows per venue.
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.headcount_estimates_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  LIKE public.headcount_estimates INCLUDING DEFAULTS INCLUDING CONSTRAINTS
);

-- Lookback queries: "what did this venue look like over the last N hours?"
CREATE INDEX IF NOT EXISTS idx_estimates_history_venue_time
  ON public.headcount_estimates_history (venue_id, computed_at DESC);

-- Time-series queries: "all venues at this point in time"
CREATE INDEX IF NOT EXISTS idx_estimates_history_time
  ON public.headcount_estimates_history (computed_at DESC);

ALTER TABLE public.headcount_estimates_history ENABLE ROW LEVEL SECURITY;
-- No policies → service_role only. Public reads come from the live table.

-- ───────────────────────────────────────────────────────────────
-- Trigger fn: copy every INSERT/UPDATE on headcount_estimates into
-- history. Explicit column list so we fail loudly if someone adds
-- a parent column without updating this trigger (rather than
-- silently dropping data).
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.headcount_estimates_log_to_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.headcount_estimates_history (
    venue_id,
    estimate, estimate_low, estimate_high,
    confidence, confidence_pct,
    capacity_pct,
    state_label, trend,
    baseline_component, signal_component,
    override_active, override_expires_at,
    dominant_signal_source, active_signal_count,
    last_signal_at,
    source_breakdown,
    computed_at,
    last_calculated_at, updated_at
  ) VALUES (
    NEW.venue_id,
    NEW.estimate, NEW.estimate_low, NEW.estimate_high,
    NEW.confidence, NEW.confidence_pct,
    NEW.capacity_pct,
    NEW.state_label, NEW.trend,
    NEW.baseline_component, NEW.signal_component,
    NEW.override_active, NEW.override_expires_at,
    NEW.dominant_signal_source, NEW.active_signal_count,
    NEW.last_signal_at,
    NEW.source_breakdown,
    NEW.computed_at,
    NEW.last_calculated_at, NEW.updated_at
  );
  RETURN NEW;
END;
$$;

-- Drop-then-create so re-running the migration replaces the trigger
-- with the current definition rather than silently no-op'ing.
DROP TRIGGER IF EXISTS trg_headcount_estimates_log_to_history
  ON public.headcount_estimates;

CREATE TRIGGER trg_headcount_estimates_log_to_history
AFTER INSERT OR UPDATE ON public.headcount_estimates
FOR EACH ROW EXECUTE FUNCTION public.headcount_estimates_log_to_history();

-- ───────────────────────────────────────────────────────────────
-- Verify
-- ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  table_ok boolean;
  trigger_ok boolean;
  history_cols int;
  parent_cols int;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'headcount_estimates_history'
  ) INTO table_ok;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_headcount_estimates_log_to_history'
      AND tgrelid = 'public.headcount_estimates'::regclass
  ) INTO trigger_ok;

  SELECT COUNT(*) INTO history_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'headcount_estimates_history';

  SELECT COUNT(*) INTO parent_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'headcount_estimates';

  RAISE NOTICE '═══ Migration 00018 complete ═══';
  RAISE NOTICE '  headcount_estimates_history table:  %', CASE WHEN table_ok   THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  AFTER INSERT OR UPDATE trigger:     %', CASE WHEN trigger_ok THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '  Indexes: (venue_id, computed_at DESC), (computed_at DESC)';
  RAISE NOTICE '  Columns: history=% (parent + 1 surrogate id), parent=%', history_cols, parent_cols;
  RAISE NOTICE '';
  RAISE NOTICE 'Per-cycle row volume: ~75 venues * 60 cycles/hr * 10hr/night ~= 45k rows/night.';
  RAISE NOTICE 'No retention policy yet — prune later via:';
  RAISE NOTICE '  DELETE FROM headcount_estimates_history WHERE computed_at < now() - interval ''90 days'';';
END $$;

COMMIT;
