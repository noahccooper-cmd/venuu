import { useEffect, useRef } from 'react';
import type { Map as MapboxMap, GeoJSONSource } from 'mapbox-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { HeatPointProps } from '../../hooks/useHeatField';

/**
 * HeatFieldLayer
 *
 * Imperative controller for three Mapbox layers (no JSX output):
 *   • heat-field-base-layer    — snap-mode density heatmap. Signal-gated
 *                                (heat_weight_signal). Dominant at
 *                                continental → city zoom (< 11.5),
 *                                crossfades to 0 by zoom 13.5.
 *   • heat-canvas-vibe         — per-venue blurred circle, paints the
 *                                city in 14 hues. 0 until zoom 11.5,
 *                                fades in to dominant by 13.5.
 *   • heat-field-halos-layer   — per-venue circle, prominent at zoom ≥ 13.
 *
 * All three insert BEFORE the '3d-buildings' style layer in this stack
 * order so they render beneath the buildings:
 *   base (bottom) → vibe canvas → halos (top of heat stack).
 *
 * Phase D (Dual heat): the wide-zoom snap heatmap returns alongside
 * the Phase C vibe canvas. Each layer reads a different weight column
 * (heat_weight_signal vs heat_weight) so the snap layer respects the
 * truth floor while the canvas always paints baseline vibe.
 *
 * A 100 ms `setInterval` ticks the breath: a sinusoidal opacity multiplier
 * with a 60-second period and ±5% amplitude that runs at all times,
 * independent of fusion-data churn. Live data updates trigger a 600 ms
 * intensity burst on top of the breath so a fresh cycle visually pops.
 * The breath multiplies the per-layer opacity expression each tick;
 * zoom-crossfade gates live INSIDE the expressions so they survive
 * atomic setPaintProperty replacements.
 *
 * Tap-bleed: when `selectedVenueId` is non-null, the halos layer's
 * circle-radius gets multiplied around that venue. The multiplier
 * animates 1.0 → 2.5 over 600 ms on select (easeOutCubic) and back
 * to 1.0 over 400 ms on deselect (easeInCubic).
 */

interface HeatFieldLayerProps {
  map: MapboxMap;
  mapLoaded: boolean;
  geojson: FeatureCollection<Point, HeatPointProps>;
  mode: 'day' | 'night';
  /** Phase C — venue currently selected (e.g. VenueSheet open). Drives
   *  the tap-bleed expansion in the halos layer. Null → no bleed. */
  selectedVenueId?: string | null;
}

const BASE_LAYER_ID = 'heat-field-base-layer';
const CANVAS_LAYER_ID = 'heat-canvas-vibe';
const HALO_LAYER_ID = 'heat-field-halos-layer';
const CANVAS_SOURCE_ID = 'heat-field-base';
const HALO_SOURCE_ID = 'heat-field-halos';

// Halos still use a client-side zoom-keyed opacity envelope multiplied
// by the breath scalar each tick (legacy pattern; halos paint a flat
// number rather than a per-feature expression).
const HALO_OPACITY_STOPS: ReadonlyArray<readonly [number, number]> = [
  [13, 0.0],
  [14, 0.6],
  [16, 0.85],
  [18, 0.5],
];

// Zoom-crossfade between snap-mode (wide) and vibe canvas (tight).
// Snap-mode dominant below 11.5, vibe canvas dominant above 13.5,
// linear crossfade in between. The breath loop rebuilds these
// expressions each tick with a scalar breath multiplier applied.
/* eslint-disable @typescript-eslint/no-explicit-any */
function snapZoomGateExpr(): any {
  return [
    'interpolate', ['linear'], ['zoom'],
    0,    0.85,
    11.5, 0.85,
    13.5, 0,
    22,   0,
  ];
}
function canvasZoomGateExpr(): any {
  return [
    'interpolate', ['linear'], ['zoom'],
    0,    0,
    11.5, 0,
    13.5, 1,
    22,   1,
  ];
}
function canvasHeatWeightExpr(): any {
  return [
    'interpolate', ['linear'], ['get', 'heat_weight'],
    0, 0.20,
    1, 0.55,
  ];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Halo baseline radius — interpolation on heat_weight. Reused inside
// the tap-bleed expression rebuild every animation frame. Returned
// as a fresh array each call so Mapbox's mutable ExpressionSpec type
// is satisfied and consumers can wrap/extend without aliasing.
/* eslint-disable @typescript-eslint/no-explicit-any */
function haloBaseRadiusExpr(): any {
  return [
    'interpolate', ['linear'], ['get', 'heat_weight'],
    0,    0,
    0.3,  30,
    0.5,  50,
    0.7,  75,
    0.85, 100,
    1.0,  130,
  ];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Linear interpolation between zoom stops; clamps outside the range. */
function evalLinearStops(stops: ReadonlyArray<readonly [number, number]>, zoom: number): number {
  if (zoom <= stops[0][0]) return stops[0][1];
  if (zoom >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [z1, v1] = stops[i];
    const [z2, v2] = stops[i + 1];
    if (zoom >= z1 && zoom <= z2) {
      const t = (zoom - z1) / (z2 - z1);
      return v1 + (v2 - v1) * t;
    }
  }
  return stops[stops.length - 1][1];
}

function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3); }
function easeInCubic(t: number): number  { return t * t * t; }

/* eslint-disable @typescript-eslint/no-explicit-any */
// Snap-mode density heatmap — restored from pre-Phase-C git HEAD with
// two deltas: heatmap-weight reads `heat_weight_signal` (truth-floor
// gated), and heatmap-opacity becomes a zoom-crossfade expression
// (was flat 1.0 overwritten by breath loop). The breath loop now
// multiplies the crossfade expression by a scalar each tick.
const BASE_LAYER_SPEC: any = {
  type: 'heatmap',
  source: CANVAS_SOURCE_ID,
  maxzoom: 16,
  paint: {
    'heatmap-weight': [
      'interpolate', ['linear'], ['get', 'heat_weight_signal'],
      0,    0,
      0.3,  0.4,
      0.5,  0.6,
      0.7,  0.85,
      0.85, 1.0,
      1.0,  1.2,
    ],
    'heatmap-intensity': [
      'interpolate', ['exponential', 1.6], ['zoom'],
      6,  1.5,    // continental view — heat is THE map
      8,  2.5,    // regional view — venuu cities glow as constellation
      10, 2.8,    // metro view — neighborhood-level pulse
      12, 2.0,    // city view — heat strong but bubbles emerging
      13, 1.4,    // bubble layer takes over
      15, 0.8,    // bubbles dominate
      16, 0.3,    // heat fades to background haze
    ],
    'heatmap-color': [
      'interpolate', ['linear'], ['heatmap-density'],
      0,    'rgba(10, 14, 28, 0)',         // transparent void
      0.08, 'rgba(45, 28, 78, 0.50)',      // softer entry purple
      0.20, 'rgba(78, 38, 110, 0.68)',     // deeper amethyst
      0.35, 'rgba(140, 70, 50, 0.74)',     // warm copper
      0.50, 'rgba(180, 75, 45, 0.80)',     // burnt orange
      0.65, 'rgba(165, 35, 60, 0.84)',     // crimson
      0.78, 'rgba(110, 25, 90, 0.86)',     // magenta-wine
      0.88, 'rgba(0, 130, 90, 0.86)',      // pre-Surging emerald
      0.95, 'rgba(0, 220, 145, 0.78)',
      1.0,  'rgba(50, 255, 175, 0.70)',    // peak luminous green
    ],
    'heatmap-radius': [
      'interpolate', ['exponential', 1.5], ['zoom'],
      6,  18,     // continental dots
      8,  35,     // city-sized blooms
      10, 60,
      12, 90,     // neighborhood smears blend together
      14, 120,
      16, 160,    // per-venue halos at high zoom
    ],
    // Zoom-crossfade lives in the expression; breath loop multiplies.
    'heatmap-opacity': snapZoomGateExpr(),
  },
};

const CANVAS_LAYER_SPEC: any = {
  type: 'circle',
  source: CANVAS_SOURCE_ID,
  paint: {
    // Bigger circles at wide zoom so the canvas covers; receding at
    // tight zoom so bubbles emerge as the focal language.
    'circle-radius': [
      'interpolate', ['linear'], ['zoom'],
      9,  120,
      12, 80,
      15, 50,
      18, 30,
    ],
    // Per-feature vibe color built from hue_degrees + saturation.
    'circle-color': [
      'concat', 'hsl(',
      ['to-string', ['get', 'hue_degrees']], ', ',
      ['to-string', ['get', 'hue_default_saturation']], '%, 50%)',
    ],
    // Per-feature heat_weight × zoom crossfade (inverse of snap layer
    // gate so canvas fades IN as snap fades OUT). Breath loop multiplies
    // by a scalar each tick — see updateOpacities() below.
    'circle-opacity': [
      '*',
      canvasHeatWeightExpr(),
      canvasZoomGateExpr(),
    ],
    'circle-blur': 1.2,
    'circle-pitch-alignment': 'map',
  },
};

const HALO_LAYER_SPEC: any = {
  type: 'circle',
  source: HALO_SOURCE_ID,
  minzoom: 13,
  paint: {
    'circle-radius': haloBaseRadiusExpr(),
    'circle-color': [
      'concat', 'hsl(',
      ['to-string', ['get', 'hue_degrees']], ', ',
      ['to-string', ['get', 'hue_default_saturation']], '%, 55%)',
    ],
    'circle-blur': 1.0,
    'circle-opacity': 0.0, // overwritten every tick by the breath loop
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export function HeatFieldLayer({ map, mapLoaded, geojson, mode, selectedVenueId }: HeatFieldLayerProps) {
  const layersAddedRef = useRef(false);
  const burstUntilRef = useRef(0);

  // ── Tap-bleed animation state ───────────────────────────────
  // `currentMultiplierRef` is the live radius multiplier (1.0 baseline,
  // up to 2.5 at peak bleed). `bleedVenueIdRef` is the venue we're
  // animating around — it may differ from selectedVenueId during the
  // wind-down phase (deselect retracts the bleed around the previously
  // selected venue). `animRafRef` holds the in-flight rAF handle.
  const currentMultiplierRef = useRef(1.0);
  const bleedVenueIdRef = useRef<string | null>(null);
  const animRafRef = useRef<number | null>(null);

  // ── Layer install / teardown ────────────────────────────────
  useEffect(() => {
    if (!mapLoaded) return;

    const beforeId = map.getLayer('3d-buildings') ? '3d-buildings' : undefined;

    try {
      if (!map.getSource(HALO_SOURCE_ID)) {
        map.addSource(HALO_SOURCE_ID, { type: 'geojson', data: geojson });
      }
      if (!map.getSource(CANVAS_SOURCE_ID)) {
        map.addSource(CANVAS_SOURCE_ID, { type: 'geojson', data: geojson });
      }
      // Insertion order matters: each addLayer(spec, beforeId) puts the
      // new layer just below beforeId, so later additions land HIGHER
      // in the stack. We want bottom → top:
      //   base (snap) → canvas (vibe) → halos
      if (!map.getLayer(BASE_LAYER_ID)) {
        map.addLayer({ id: BASE_LAYER_ID, ...BASE_LAYER_SPEC }, beforeId);
      }
      if (!map.getLayer(CANVAS_LAYER_ID)) {
        map.addLayer({ id: CANVAS_LAYER_ID, ...CANVAS_LAYER_SPEC }, beforeId);
      }
      if (!map.getLayer(HALO_LAYER_ID)) {
        map.addLayer({ id: HALO_LAYER_ID, ...HALO_LAYER_SPEC }, beforeId);
      }
      layersAddedRef.current = true;
    } catch (err) {
      console.warn('[HeatFieldLayer] install failed:', err);
    }

    return () => {
      try {
        if (map.getLayer(HALO_LAYER_ID)) map.removeLayer(HALO_LAYER_ID);
        if (map.getLayer(CANVAS_LAYER_ID)) map.removeLayer(CANVAS_LAYER_ID);
        if (map.getLayer(BASE_LAYER_ID)) map.removeLayer(BASE_LAYER_ID);
        if (map.getSource(CANVAS_SOURCE_ID)) map.removeSource(CANVAS_SOURCE_ID);
        if (map.getSource(HALO_SOURCE_ID)) map.removeSource(HALO_SOURCE_ID);
      } catch {
        // map may be torn down already
      }
      layersAddedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mapLoaded]);

  // ── Data sync on geojson change ─────────────────────────────
  useEffect(() => {
    if (!mapLoaded || !layersAddedRef.current) return;
    const canvasSrc = map.getSource(CANVAS_SOURCE_ID) as GeoJSONSource | undefined;
    const haloSrc = map.getSource(HALO_SOURCE_ID) as GeoJSONSource | undefined;
    if (canvasSrc) canvasSrc.setData(geojson);
    if (haloSrc) haloSrc.setData(geojson);
    // Trigger a 600ms intensity burst on top of the breath
    burstUntilRef.current = Date.now() + 600;
  }, [geojson, mapLoaded, map]);

  // ── Breath + burst loop ─────────────────────────────────────
  useEffect(() => {
    if (!mapLoaded) return;
    const interval = window.setInterval(() => {
      if (!layersAddedRef.current) return;
      const now = Date.now();
      const zoom = map.getZoom();

      // 60-second sinusoidal breath, ±5% amplitude
      const phase = (now % 60_000) / 60_000;
      const breathe = 0.95 + 0.10 * Math.sin(phase * Math.PI * 2);

      // 15% burst that decays linearly over 600ms (no hard step)
      const remaining = burstUntilRef.current - now;
      const burst = remaining > 0 ? 1.0 + 0.15 * (remaining / 600) : 1.0;

      // 10% intensity boost during nightlife hours
      const nightBoost = mode === 'night' ? 1.10 : 1.0;

      // Phase D — zoom crossfade gates live INSIDE the layer opacity
      // expressions. The breath loop multiplies the whole expression
      // by a scalar (breath × burst × night-boost). Halos still use
      // the flat-number pattern because their zoom envelope is small
      // and a single number is simpler than rebuilding an expression.
      const breathScalar = Math.min(1.0, breathe * burst * nightBoost);
      const haloOpacity = evalLinearStops(HALO_OPACITY_STOPS, zoom) * breathe * burst * nightBoost;

      try {
        // Snap heatmap: zoom-crossfade × breath scalar.
        map.setPaintProperty(BASE_LAYER_ID, 'heatmap-opacity', [
          '*',
          snapZoomGateExpr(),
          breathScalar,
        ]);
        // Vibe canvas: per-feature heat_weight × inverse zoom-crossfade × breath.
        map.setPaintProperty(CANVAS_LAYER_ID, 'circle-opacity', [
          '*',
          canvasHeatWeightExpr(),
          canvasZoomGateExpr(),
          breathScalar,
        ]);
        map.setPaintProperty(HALO_LAYER_ID, 'circle-opacity', Math.min(1.0, haloOpacity));
      } catch {
        // layer briefly gone during a style swap — next tick recovers
      }
    }, 100);

    return () => window.clearInterval(interval);
  }, [map, mapLoaded, mode]);

  // ── Tap-bleed animation ─────────────────────────────────────
  // Drives the halos' circle-radius multiplier around the selected
  // venue. On select: 1.0 → 2.5 over 600ms easeOutCubic. On deselect:
  // current → 1.0 over 400ms easeInCubic around the venue we were
  // last bleeding (so the retract is visible even after the prop
  // cleared).
  useEffect(() => {
    if (!mapLoaded || !layersAddedRef.current) return;

    // Cancel any in-flight animation.
    if (animRafRef.current != null) {
      cancelAnimationFrame(animRafRef.current);
      animRafRef.current = null;
    }

    const selecting = selectedVenueId != null && selectedVenueId !== bleedVenueIdRef.current;
    const deselecting = selectedVenueId == null && bleedVenueIdRef.current != null;
    const switching = selectedVenueId != null && bleedVenueIdRef.current != null && selectedVenueId !== bleedVenueIdRef.current;

    // No-op cases:
    //   - prop unchanged and we're already at the right multiplier
    //   - prop cleared and multiplier is already 1.0 (nothing to retract)
    if (!selecting && !deselecting) return;

    const fromMultiplier = currentMultiplierRef.current;
    const toMultiplier = selectedVenueId != null ? 2.5 : 1.0;
    const duration = selecting || switching ? 600 : 400;
    const easing = selecting || switching ? easeOutCubic : easeInCubic;
    // Anchor the animation around the SELECTED venue when one is
    // present; on deselect, anchor around the previous bleed venue so
    // the retract is visible before clearing.
    const anchorId = selectedVenueId ?? bleedVenueIdRef.current;
    if (selectedVenueId != null) {
      bleedVenueIdRef.current = selectedVenueId;
    }

    const startTime = performance.now();

    const tick = (nowMs: number) => {
      if (!layersAddedRef.current) {
        animRafRef.current = null;
        return;
      }
      const t = Math.min(1, (nowMs - startTime) / duration);
      const eased = easing(t);
      const mult = fromMultiplier + (toMultiplier - fromMultiplier) * eased;
      currentMultiplierRef.current = mult;

      // Rebuild the per-frame halo radius expression.
      const expr = anchorId
        ? [
            'case',
            ['==', ['get', 'venue_id'], anchorId],
            ['*', haloBaseRadiusExpr(), mult],
            haloBaseRadiusExpr(),
          ]
        : haloBaseRadiusExpr();

      try {
        map.setPaintProperty(HALO_LAYER_ID, 'circle-radius', expr);
      } catch {
        // layer briefly gone — skip this frame
      }

      if (t < 1) {
        animRafRef.current = requestAnimationFrame(tick);
      } else {
        animRafRef.current = null;
        // On full retract, clear the anchor so the next select starts
        // from a clean baseline expression.
        if (selectedVenueId == null) {
          bleedVenueIdRef.current = null;
          try {
            map.setPaintProperty(HALO_LAYER_ID, 'circle-radius', haloBaseRadiusExpr());
          } catch {
            // layer briefly gone
          }
        }
      }
    };

    animRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (animRafRef.current != null) {
        cancelAnimationFrame(animRafRef.current);
        animRafRef.current = null;
      }
    };
  }, [selectedVenueId, mapLoaded, map]);

  return null;
}
