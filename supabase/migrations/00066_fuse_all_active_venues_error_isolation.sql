-- ═══════════════════════════════════════════════════════════════
-- 00066_fuse_all_active_venues_error_isolation.sql
--
-- SAFETY HARDENING — Step 1 of the manual-curve engine integration.
-- Applied FIRST and ALONE, before any cascade or reader changes.
--
-- PROBLEM: fuse_all_active_venues() (live version: 00040) loops every
-- active launch venue and runs compute_venue_estimate + UPSERT inside
-- ONE transaction with NO per-venue exception handling. If a single
-- venue's computation or insert throws, the exception propagates out of
-- the loop and rolls back EVERY venue's update for that tick — the whole
-- city's estimates freeze until the next clean minute-cron run. With the
-- fusion cron firing every minute, that blast radius is continuous.
--
-- FIX: wrap the per-venue work (compute_venue_estimate through the end of
-- the INSERT ... ON CONFLICT) in a BEGIN ... EXCEPTION WHEN OTHERS block.
-- A throwing venue is caught, logged as a WARNING (not re-raised), its
-- partial work rolled back via the implicit subtransaction savepoint, and
-- the loop proceeds to the next venue. v_count increments only on success.
--
-- This is the prerequisite guarantee for introducing manual-curve logic:
-- a single bad venue (or bad manual_curve row) can never freeze the city.
--
-- EVERYTHING ELSE IS BYTE-FOR-BYTE IDENTICAL TO 00040:
--   - the venue selection WHERE clause
--   - the trend → 'flat' mapping
--   - the full INSERT column list and ON CONFLICT DO UPDATE
--   - the RETURN v_count
--
-- Idempotent (CREATE OR REPLACE). Wrapped in BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.fuse_all_active_venues()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_venue record;
  v_est record;
  v_count int := 0;
  v_trend_for_db text;
BEGIN
  FOR v_venue IN
    SELECT id FROM public.venues
    WHERE COALESCE(is_active, true) = true
      AND (category IS NULL OR category NOT IN ('greek', 'fraternity'))
      AND city IN ('knoxville', 'tampa', 'st_petersburg')
  LOOP
    -- ── Per-venue isolation: a throw here is caught, logged, and skipped
    --    so one bad venue can never roll back the whole batch. ──────────
    BEGIN
      SELECT * INTO v_est FROM public.compute_venue_estimate(v_venue.id);
      IF v_est IS NULL THEN
        CONTINUE;
      END IF;

      v_trend_for_db := CASE
        WHEN v_est.trend IS NULL OR v_est.trend = 'stable' THEN 'flat'
        ELSE v_est.trend
      END;

      INSERT INTO public.headcount_estimates (
        venue_id, estimate, estimate_low, estimate_high,
        confidence, confidence_pct,
        capacity_pct, state_label, trend, trend_rate,
        baseline_component, signal_component,
        override_active, last_signal_at,
        source_breakdown, computed_at,
        last_calculated_at, updated_at,
        delta_pct, expected_pct
      ) VALUES (
        v_venue.id,
        v_est.estimate, v_est.estimate_low, v_est.estimate_high,
        v_est.confidence_pct / 100.0, v_est.confidence_pct,
        v_est.capacity_pct, v_est.state_label, v_trend_for_db, v_est.trend_rate,
        v_est.baseline_component, v_est.signal_component,
        v_est.override_active, v_est.last_signal_at,
        v_est.source_breakdown, now(),
        now(), now(),
        v_est.delta_pct, v_est.expected_pct
      )
      ON CONFLICT (venue_id) DO UPDATE SET
        estimate          = EXCLUDED.estimate,
        estimate_low      = EXCLUDED.estimate_low,
        estimate_high     = EXCLUDED.estimate_high,
        confidence        = EXCLUDED.confidence,
        confidence_pct    = EXCLUDED.confidence_pct,
        capacity_pct      = EXCLUDED.capacity_pct,
        state_label       = EXCLUDED.state_label,
        trend             = EXCLUDED.trend,
        trend_rate        = EXCLUDED.trend_rate,
        baseline_component = EXCLUDED.baseline_component,
        signal_component  = EXCLUDED.signal_component,
        override_active   = EXCLUDED.override_active,
        last_signal_at    = EXCLUDED.last_signal_at,
        source_breakdown  = EXCLUDED.source_breakdown,
        computed_at       = EXCLUDED.computed_at,
        last_calculated_at = EXCLUDED.last_calculated_at,
        updated_at        = now(),
        delta_pct         = EXCLUDED.delta_pct,
        expected_pct      = EXCLUDED.expected_pct;

      v_count := v_count + 1;
    EXCEPTION
      WHEN OTHERS THEN
        -- Swallow: skip this venue, keep the batch alive. Do NOT re-raise,
        -- do NOT increment v_count. Visible in logs for diagnosis.
        RAISE WARNING 'fuse_all_active_venues: skipped venue % — %',
          v_venue.id, SQLERRM;
    END;
  END LOOP;

  RETURN v_count;
END;
$function$;

DO $$
BEGIN
  RAISE NOTICE '-----------------------------------';
  RAISE NOTICE 'fuse_all_active_venues hardened (00066)';
  RAISE NOTICE 'Per-venue BEGIN/EXCEPTION isolation added.';
  RAISE NOTICE 'One throwing venue no longer rolls back the city.';
  RAISE NOTICE 'Body otherwise byte-for-byte identical to 00040.';
  RAISE NOTICE '-----------------------------------';
END $$;

COMMIT;
