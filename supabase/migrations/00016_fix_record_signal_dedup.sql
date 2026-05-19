-- ═══════════════════════════════════════════════════════════════
-- 00016_fix_record_signal_dedup.sql
--
-- Bug fix: record_signal's dedup EXISTS check was missing
-- signal_type. After the BestTime live refresh started inserting
-- multiple signal rows that share the same (source_table,
-- source_row_id) — namely besttime_forecast_now, besttime_live, and
-- besttime_anomaly all pointing at the same besttime_live_snapshots
-- row — the second and third writes were silently rejected.
--
-- Fix: include signal_type in the uniqueness check so the three
-- BestTime signals can all coexist for one snapshot.
--
-- Idempotent. Wrapped in BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.record_signal(
  p_venue_id uuid,
  p_user_id uuid,
  p_signal_type text,
  p_signal_value numeric DEFAULT 1.0,
  p_source_table text DEFAULT NULL,
  p_source_row_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ttl_seconds integer;
  v_signal_id uuid;
BEGIN
  IF p_venue_id IS NULL OR p_signal_type IS NULL THEN
    RETURN NULL;
  END IF;

  -- Look up TTL for this signal type. If not found, fall back to 1 hour.
  SELECT ttl_seconds INTO v_ttl_seconds
  FROM public.signal_weights WHERE signal_type = p_signal_type;

  IF v_ttl_seconds IS NULL THEN
    v_ttl_seconds := 3600;
  END IF;

  -- Dedup: if source_table + source_row_id + signal_type already exist, skip.
  IF p_source_table IS NOT NULL AND p_source_row_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.headcount_signals
      WHERE source_table = p_source_table
        AND source_row_id = p_source_row_id
        AND signal_type = p_signal_type
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO public.headcount_signals (
    venue_id, user_id, signal_type, signal_value,
    recorded_at, expires_at, source_table, source_row_id, metadata
  ) VALUES (
    p_venue_id, p_user_id, p_signal_type, p_signal_value,
    now(), now() + (v_ttl_seconds || ' seconds')::interval,
    p_source_table, p_source_row_id, p_metadata
  )
  RETURNING id INTO v_signal_id;

  RETURN v_signal_id;
EXCEPTION WHEN OTHERS THEN
  -- Never let a signal-write failure break the parent transaction
  RAISE WARNING 'record_signal failed: % %', SQLERRM, SQLSTATE;
  RETURN NULL;
END;
$$;

DO $$
BEGIN
  RAISE NOTICE 'record_signal dedup logic now includes signal_type in uniqueness check. besttime_live and besttime_anomaly signals will now land alongside besttime_forecast_now for the same source row.';
END $$;

COMMIT;
