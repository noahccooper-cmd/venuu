/**
 * hueMath.ts
 *
 * The 14-hue vibe spectrum lookup. Single source of truth for a
 * venue's signature hue (1-14 → HSL degrees), keyed off
 * vibe_hue_baseline. Mirrors the vibe_hue_lookup table in Postgres.
 * Keep in sync.
 */

export type VibeHueId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface VibeHue {
  id: VibeHueId;
  name: string;
  degrees: number;        // HSL hue, 0-360
  defaultSat: number;     // baseline saturation when state is unknown
  displayHex: string;     // fallback / swatch color
  anchor: string;         // internal description (not for users)
}

export const VIBE_HUES: VibeHue[] = [
  { id: 1,  name: 'Deep Indigo',         degrees: 250, defaultSat: 45, displayHex: '#2E2A6E', anchor: 'after-hours, intimate, very late' },
  { id: 2,  name: 'Royal Blue',          degrees: 220, defaultSat: 65, displayHex: '#3B5BDB', anchor: 'cocktail polish, sleek, after-work' },
  { id: 3,  name: 'Sky / Cyan',          degrees: 190, defaultSat: 55, displayHex: '#3FB8C9', anchor: 'daylight chill, café, brunch' },
  { id: 4,  name: 'Sea Green',           degrees: 165, defaultSat: 55, displayHex: '#1FB58D', anchor: 'patio energy, easy, mid-week' },
  { id: 5,  name: 'Fresh Green',         degrees: 130, defaultSat: 50, displayHex: '#52C66A', anchor: 'dinner, grounded, casual restaurant' },
  { id: 6,  name: 'Olive / Sage',        degrees:  80, defaultSat: 40, displayHex: '#9CB257', anchor: 'wine bar, slower conversation' },
  { id: 7,  name: 'Yellow-Gold',         degrees:  45, defaultSat: 75, displayHex: '#FFD56B', anchor: 'warming up, neighborhood bar' },
  { id: 8,  name: 'Warm Orange',         degrees:  30, defaultSat: 90, displayHex: '#FF8200', anchor: 'loud bar, mid-energy, college' },
  { id: 9,  name: 'Deep Orange',         degrees:  18, defaultSat: 90, displayHex: '#FF5B1E', anchor: 'packed bar, full warmth' },
  { id: 10, name: 'Crimson Red',         degrees: 350, defaultSat: 75, displayHex: '#E63956', anchor: 'rage, dance floor, peak' },
  { id: 11, name: 'Wine / Burgundy',     degrees: 335, defaultSat: 65, displayHex: '#8E1B3A', anchor: 'darker club, harder edge' },
  { id: 12, name: 'Magenta / Plum',      degrees: 315, defaultSat: 55, displayHex: '#A4308E', anchor: 'alt scene, queer venues, art' },
  { id: 13, name: 'Violet',              degrees: 270, defaultSat: 55, displayHex: '#7A4DC9', anchor: 'mood lounge, intimate dance' },
  { id: 14, name: 'Cool Grey-Lavender',  degrees: 240, defaultSat: 18, displayHex: '#9098B8', anchor: 'off-peak any venue, restful' },
];

export const HUE_BY_ID: Record<VibeHueId, VibeHue> = VIBE_HUES.reduce(
  (acc, h) => { acc[h.id] = h; return acc; },
  {} as Record<VibeHueId, VibeHue>
);

/**
 * Find the closest hue ID by angular distance on the wheel.
 * Used for aggregating user paints into a single hue ID.
 */
export function closestHueByDegrees(degrees: number): VibeHueId {
  let bestId: VibeHueId = 14;
  let bestDist = 360;
  for (const hue of VIBE_HUES) {
    let dist = Math.abs(degrees - hue.degrees);
    if (dist > 180) dist = 360 - dist;
    if (dist < bestDist) {
      bestDist = dist;
      bestId = hue.id;
    }
  }
  return bestId;
}
