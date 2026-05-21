import { useEffect, useRef } from 'react';
import type { Map as MapboxMap, GeoJSONSource } from 'mapbox-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { HeatPointProps } from '../../hooks/useHeatField';

/**
 * HeatFieldLayer
 *
 * Imperative controller for two Mapbox layers (no JSX output):
 *   • heat-field-base-layer  — heatmap, dominant at zoom < 14
 *   • heat-field-halos-layer — per-venue circle, prominent at zoom ≥ 13
 *
 * Both layers are inserted BEFORE the '3d-buildings' style layer so they
 * render beneath the buildings and well beneath HTML-marker bubbles.
 *
 * A 100 ms `setInterval` ticks the breath: a sinusoidal opacity multiplier
 * with a 60-second period and ±5% amplitude that runs at all times,
 * independent of fusion-data churn. Live data updates trigger a 600 ms
 * intensity burst on top of the breath so a fresh cycle visually pops.
 *
 * Because Mapbox `setPaintProperty` replaces a paint property atomically
 * (it can't compose with the existing zoom-interpolation expression), we
 * evaluate the zoom-opacity ramp client-side every tick and submit a flat
 * number that already encodes (zoom × breath × burst × night-boost).
 */

interface HeatFieldLayerProps {
  map: MapboxMap;
  mapLoaded: boolean;
  geojson: FeatureCollection<Point, HeatPointProps>;
  mode: 'day' | 'night';
}

const BASE_LAYER_ID = 'heat-field-base-layer';
const HALO_LAYER_ID = 'heat-field-halos-layer';
const BASE_SOURCE_ID = 'heat-field-base';
const HALO_SOURCE_ID = 'heat-field-halos';

const BASE_OPACITY_STOPS: ReadonlyArray<readonly [number, number]> = [
  [6, 0.95],   // dominant at continental zoom
  [11, 1.0],
  [13, 0.85],  // letting bubbles through
  [15, 0.45],
  [17, 0.2],
];

const HALO_OPACITY_STOPS: ReadonlyArray<readonly [number, number]> = [
  [13, 0.0],
  [14, 0.6],
  [16, 0.85],
  [18, 0.5],
];

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

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE_LAYER_SPEC: any = {
  type: 'heatmap',
  source: BASE_SOURCE_ID,
  maxzoom: 16,
  paint: {
    'heatmap-weight': [
      'interpolate', ['linear'], ['get', 'heat_weight'],
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
    // Zoom-gated fadeout: full opacity below z 12.5, fades to 0 by z 13.5
    // so the WebGL canvas (zoom 14+) takes over without overlap. The
    // breath loop below only writes setPaintProperty when zoom < 13, so
    // this layout-time expression governs at the crossover zone.
    'heatmap-opacity': [
      'interpolate', ['linear'], ['zoom'],
      10, 1.0,
      12.5, 1.0,
      13.5, 0.0,
      18, 0.0,
    ],
  },
};

const HALO_LAYER_SPEC: any = {
  type: 'circle',
  source: HALO_SOURCE_ID,
  minzoom: 13,
  paint: {
    'circle-radius': [
      'interpolate', ['linear'], ['get', 'heat_weight'],
      0,    0,
      0.3,  30,
      0.5,  50,
      0.7,  75,
      0.85, 100,
      1.0,  130,
    ],
    'circle-color': [
      'match', ['get', 'state_label'],
      'Quiet',   'rgba(61, 42, 94, 0.45)',     // purple
      'Lively',  'rgba(94, 73, 35, 0.50)',
      'Busy',    'rgba(139, 64, 36, 0.55)',
      'Packed',  'rgba(125, 28, 51, 0.58)',
      'Surging', 'rgba(0, 200, 130, 0.50)',
      'rgba(0, 0, 0, 0)',                       // Unknown invisible
    ],
    'circle-blur': 1.0,
    // Halos visible at mid-zoom band where they already worked; fade out
    // by z 14.5 as the WebGL canvas takes over. Breath loop guards by zoom.
    'circle-opacity': [
      'interpolate', ['linear'], ['zoom'],
      10, 0.0,
      13, 0.85,
      14, 0.85,
      14.5, 0.0,
      18, 0.0,
    ],
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export function HeatFieldLayer({ map, mapLoaded, geojson, mode }: HeatFieldLayerProps) {
  const layersAddedRef = useRef(false);
  const burstUntilRef = useRef(0);

  // ── Layer install / teardown ────────────────────────────────
  useEffect(() => {
    if (!mapLoaded) return;

    const beforeId = map.getLayer('3d-buildings') ? '3d-buildings' : undefined;

    try {
      if (!map.getSource(HALO_SOURCE_ID)) {
        map.addSource(HALO_SOURCE_ID, { type: 'geojson', data: geojson });
      }
      if (!map.getSource(BASE_SOURCE_ID)) {
        map.addSource(BASE_SOURCE_ID, { type: 'geojson', data: geojson });
      }
      // Halo first → base on top of halo, both below 3d-buildings.
      if (!map.getLayer(HALO_LAYER_ID)) {
        map.addLayer({ id: HALO_LAYER_ID, ...HALO_LAYER_SPEC }, beforeId);
      }
      if (!map.getLayer(BASE_LAYER_ID)) {
        map.addLayer({ id: BASE_LAYER_ID, ...BASE_LAYER_SPEC }, beforeId);
      }
      layersAddedRef.current = true;
    } catch (err) {
      console.warn('[HeatFieldLayer] install failed:', err);
    }

    return () => {
      try {
        if (map.getLayer(BASE_LAYER_ID)) map.removeLayer(BASE_LAYER_ID);
        if (map.getLayer(HALO_LAYER_ID)) map.removeLayer(HALO_LAYER_ID);
        if (map.getSource(BASE_SOURCE_ID)) map.removeSource(BASE_SOURCE_ID);
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
    const baseSrc = map.getSource(BASE_SOURCE_ID) as GeoJSONSource | undefined;
    const haloSrc = map.getSource(HALO_SOURCE_ID) as GeoJSONSource | undefined;
    if (baseSrc) baseSrc.setData(geojson);
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

      const baseOpacity = evalLinearStops(BASE_OPACITY_STOPS, zoom) * breathe * burst * nightBoost;
      const haloOpacity = evalLinearStops(HALO_OPACITY_STOPS, zoom) * breathe * burst * nightBoost;

      try {
        // Phase D.5 — only override the layout-time zoom expression while
        // the heatmap is dominant (zoom < 13). Above that, the static
        // expression handles fadeout into the WebGL canvas crossover and
        // any setPaintProperty here would clobber it back to a flat value.
        if (map.getZoom() < 13.0) {
          map.setPaintProperty(BASE_LAYER_ID, 'heatmap-opacity', Math.min(1.0, baseOpacity));
          map.setPaintProperty(HALO_LAYER_ID, 'circle-opacity', Math.min(1.0, haloOpacity));
        }
      } catch {
        // layer briefly gone during a style swap — next tick recovers
      }
    }, 100);

    return () => window.clearInterval(interval);
  }, [map, mapLoaded, mode]);

  return null;
}
