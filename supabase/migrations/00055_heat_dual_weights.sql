-- ════════════════════════════════════════════════════════════════
-- 00055_heat_dual_weights.sql
--
-- Restores wide-zoom signal-gated heat alongside Phase C vibe canvas.
-- heat_weight       — always paints (for vibe canvas, close zoom)
-- heat_weight_signal — gated by confidence (for snap-mode, wide zoom)
-- ════════════════════════════════════════════════════════════════

BEGIN;

DROP VIEW IF EXISTS public.heat_points CASCADE;

CREATE VIEW public.heat_points AS
SELECT
  v.id AS venue_id,
  v.name,
  v.city,
  v.lat,
  v.lng,
  v.capacity AS venue_capacity,
  COALESCE(public.get_venue_current_hue(v.id), 14) AS hue_id,
  COALESCE(vhl.hsl_degrees, 240) AS hue_degrees,
  COALESCE(vhl.default_saturation, 18) AS hue_default_saturation,
  COALESCE(he.state_label, 'Unknown') AS state_label,
  COALESCE(he.capacity_pct, 0) AS capacity_pct,
  COALESCE(he.confidence_pct, 0) AS confidence_pct,
  COALESCE(he.estimate, 0) AS estimate,
  -- Always-on weight for vibe canvas (Phase C behavior, baseline 0.55)
  LEAST(1.0,
    0.55
    + COALESCE(he.capacity_pct, 0) * 0.3
    + CASE
        WHEN he.state_label = 'Surging' THEN 0.20
        WHEN he.state_label = 'Packed'  THEN 0.15
        WHEN he.state_label = 'Busy'    THEN 0.10
        WHEN he.state_label = 'Lively'  THEN 0.05
        ELSE 0
      END
  ) AS heat_weight,
  -- Signal-gated weight for snap-mode wide-zoom (legacy behavior)
  CASE
    WHEN COALESCE(he.confidence_pct, 0) < 15 THEN 0
    ELSE LEAST(1.0,
      COALESCE(he.capacity_pct, 0) * 0.6
      + CASE
          WHEN he.state_label = 'Surging' THEN 0.40
          WHEN he.state_label = 'Packed'  THEN 0.30
          WHEN he.state_label = 'Busy'    THEN 0.20
          WHEN he.state_label = 'Lively'  THEN 0.10
          ELSE 0
        END
    )
  END AS heat_weight_signal,
  he.last_calculated_at,
  v.is_active
FROM public.venues v
LEFT JOIN public.headcount_estimates he ON he.venue_id = v.id
LEFT JOIN public.vibe_hue_lookup vhl ON vhl.hue_id = COALESCE(public.get_venue_current_hue(v.id), 14)
WHERE v.is_active = true
  AND v.lat IS NOT NULL
  AND v.lng IS NOT NULL
  AND v.city IN ('knoxville', 'tampa', 'st_petersburg');

GRANT SELECT ON public.heat_points TO authenticated, anon;

DO $$
DECLARE
  v_total INTEGER;
  v_with_signal INTEGER;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE heat_weight_signal > 0)
  INTO v_total, v_with_signal FROM public.heat_points;
  RAISE NOTICE '─────────────────────────────────────';
  RAISE NOTICE 'HEAT DUAL WEIGHTS';
  RAISE NOTICE '  Total venues: %', v_total;
  RAISE NOTICE '  With live signal (snap-mode): %', v_with_signal;
  RAISE NOTICE '─────────────────────────────────────';
END $$;

COMMIT;
