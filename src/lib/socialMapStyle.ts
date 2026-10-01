import type { Map as MapboxMap } from 'mapbox-gl';

/** Night-map palette for a Partner World: water pulled toward the brand's
 *  primary color but darkened; land a warm near-black. Labels untouched. */
export interface WorldPalette { water: string; land: string }

const WORLD_LAND = '#1D1914';

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix a brand color toward black for a legible night-map water color.
 *  Sun Cruiser #00A0AF → ≈ #0A3A40; Pinellas green #2FBF71 → ≈ #123B26. */
export function worldPalette(primaryHex: string | null): WorldPalette {
  const rgb = primaryHex ? hexToRgb(primaryHex) : null;
  if (!rgb) return { water: '#12161C', land: WORLD_LAND };
  const base: [number, number, number] = [11, 13, 16];
  const t = 0.3;   // share of the brand color
  const mix = rgb.map((c, i) => Math.round(base[i] + (c - base[i]) * t));
  return { water: `#${mix.map(c => c.toString(16).padStart(2, '0')).join('')}`, land: WORLD_LAND };
}

interface SavedPaint { id: string; prop: string; value: unknown }

/**
 * Restyle ONLY the Social map for a Partner World via setPaintProperty,
 * animated over `ms`. Returns a restore function that puts back exactly
 * the paint values it replaced.
 */
export function applyWorldPaint(map: MapboxMap, palette: WorldPalette, ms: number): () => void {
  const saved: SavedPaint[] = [];
  const set = (id: string, prop: string, value: string) => {
    saved.push({ id, prop, value: map.getPaintProperty(id, prop as never) });
    map.setPaintProperty(id, `${prop}-transition` as never, { duration: ms, delay: 0 } as never);
    map.setPaintProperty(id, prop as never, value as never);
  };
  for (const layer of map.getStyle()?.layers ?? []) {
    const { id, type } = layer;
    if (id.startsWith('social-')) continue;
    if (type === 'background') set(id, 'background-color', palette.land);
    else if (type === 'fill' && /water/.test(id)) set(id, 'fill-color', palette.water);
    else if (type === 'line' && /waterway/.test(id)) set(id, 'line-color', palette.water);
  }
  return () => {
    for (const s of saved.reverse()) {
      if (!map.getLayer(s.id)) continue;
      map.setPaintProperty(s.id, `${s.prop}-transition` as never, { duration: ms, delay: 0 } as never);
      map.setPaintProperty(s.id, s.prop as never, s.value as never);
    }
  };
}
