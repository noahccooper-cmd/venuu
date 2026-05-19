-- ═══════════════════════════════════════════════════════════════
-- 00023_heat_points_fix_join_guard.sql
--
-- Fix: 00022's heat_points view referenced `h.id` to detect a
-- venue with no estimate row, but `headcount_estimates` keys on
-- venue_id (its primary key); there is no `id` column. The CASE
-- branch silently never fired and the join-guard fell through to
-- the next branches, which evaluate `h.source_breakdown` and
-- `h.confidence_pct` — both NULL when the LEFT JOIN had no match,
-- but those branches still classify the row as "cold". Net visual
-- effect on the map was correct (cold rows still got weight 0)
-- but the view threw a column-reference error in tools that
-- inspect the definition.
--
-- This migration re-issues `CREATE OR REPLACE VIEW heat_points`
-- with the only delta being `h.id` → `h.venue_id`. After the LEFT
-- JOIN, `h.venue_id` is NULL exactly when no estimate row exists.
--
-- 00022 itself is left untouched on disk so its applied-state row
-- in supabase_migrations.schema_migrations does not get re-run.
--
-- Idempotent. Wrapped in BEGIN/COMMIT.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE VIEW public.heat_points AS
SELECT
  v.id           AS venue_id,
  v.name,
  v.city,
  v.lat,
  v.lng,
  v.capacity,
  COALESCE(h.estimate, 0)               AS estimate,
  COALESCE(h.confidence_pct, 0)         AS confidence_pct,
  COALESCE(h.capacity_pct, 0)           AS capacity_pct,
  COALESCE(h.state_label, 'Unknown')    AS state_label,
  CASE
    WHEN h.venue_id IS NULL THEN 0.0
    WHEN COALESCE(h.source_breakdown ->> 'baseline_source', '') NOT IN
         ('besttime_live', 'besttime_forecast', 'bouncer_override') THEN 0.0
    WHEN h.confidence_pct IS NULL OR h.confidence_pct < 15 THEN 0.0
    WHEN h.state_label = 'Surging' THEN LEAST(1.0, 0.85 + (h.confidence_pct - 50) * 0.003)
    WHEN h.state_label = 'Packed'  THEN 0.70 + LEAST(0.10, h.confidence_pct * 0.001)
    WHEN h.state_label = 'Busy'    THEN 0.50 + LEAST(0.10, h.confidence_pct * 0.001)
    WHEN h.state_label = 'Lively'  THEN 0.30 + LEAST(0.10, h.confidence_pct * 0.001)
    WHEN h.state_label = 'Quiet'   THEN 0.10
    ELSE 0.0
  END AS heat_weight,
  h.computed_at
FROM public.venues v
LEFT JOIN public.headcount_estimates h ON h.venue_id = v.id
WHERE v.is_active = true
  AND v.city IN ('knoxville', 'tampa', 'st_petersburg');

GRANT SELECT ON public.heat_points TO authenticated, anon;

DO $$
DECLARE
  algo_rows int;
  cold_rows int;
BEGIN
  SELECT COUNT(*) INTO algo_rows FROM public.heat_points WHERE heat_weight > 0;
  SELECT COUNT(*) INTO cold_rows FROM public.heat_points WHERE heat_weight = 0;

  RAISE NOTICE '═══ Migration 00023 complete ═══';
  RAISE NOTICE '  heat_points re-issued with h.venue_id join guard';
  RAISE NOTICE '  Algorithm-driven rows (heat_weight > 0): %', algo_rows;
  RAISE NOTICE '  Cold rows (weight = 0):                  %', cold_rows;
END $$;

COMMIT;
