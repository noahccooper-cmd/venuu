import type { Map as MapboxMap } from 'mapbox-gl';

// Sun Cruiser World night palette: water pulled toward their teal
// (#00A0AF) but darkened for a night map; land warmed very slightly.
// Labels are untouched so they stay readable.
const SCW_WATER = '#0B3F46';
const SCW_LAND = '#1D1914';

interface SavedPaint { id: string; prop: string; value: unknown }

/**
 * Restyle ONLY the Social map for Sun Cruiser World via setPaintProperty,
 * animated over `ms`. Returns a restore function that puts back exactly
 * the paint values it replaced.
 */
export function applySunWorldPaint(map: MapboxMap, ms: number): () => void {
  const saved: SavedPaint[] = [];
  const set = (id: string, prop: string, value: string) => {
    saved.push({ id, prop, value: map.getPaintProperty(id, prop as never) });
    map.setPaintProperty(id, `${prop}-transition` as never, { duration: ms, delay: 0 } as never);
    map.setPaintProperty(id, prop as never, value as never);
  };
  for (const layer of map.getStyle()?.layers ?? []) {
    const { id, type } = layer;
    if (id.startsWith('social-')) continue;
    if (type === 'background') set(id, 'background-color', SCW_LAND);
    else if (type === 'fill' && /water/.test(id)) set(id, 'fill-color', SCW_WATER);
    else if (type === 'line' && /waterway/.test(id)) set(id, 'line-color', SCW_WATER);
  }
  return () => {
    for (const s of saved.reverse()) {
      if (!map.getLayer(s.id)) continue;
      map.setPaintProperty(s.id, `${s.prop}-transition` as never, { duration: ms, delay: 0 } as never);
      map.setPaintProperty(s.id, s.prop as never, s.value as never);
    }
  };
}
