-- ════════════════════════════════════════════════════════════════
-- 00054_heat_canvas_vibe.sql
--
-- Repoints heat_points view to include vibe-hue per venue.
-- The heatmap layer now paints in 14 hues instead of per-state colors.
-- City as canvas.
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- Drop and recreate heat_points view with vibe data joined in
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
  -- heat_weight: how much this venue contributes to the canvas
  -- baseline weight 0.55 (always visible), boosted by capacity + state intensity
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
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.heat_points;
  RAISE NOTICE '─────────────────────────────────────';
  RAISE NOTICE 'HEAT CANVAS REPOINTED';
  RAISE NOTICE '  Total heat points: %', v_count;
  RAISE NOTICE '─────────────────────────────────────';
END $$;

COMMIT;
