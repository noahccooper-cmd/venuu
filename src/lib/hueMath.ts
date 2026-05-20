/**
 * hueMath.ts
 *
 * The HSL fusion math. Single source of truth for venue color.
 *
 * - HUE comes from vibe (1-14 spectrum, mapped to HSL degrees)
 * - SATURATION comes from engine state (Surging → 100%, Quiet → 50%)
 * - LIGHTNESS comes from capacity_pct (empty → 35%, full → 55%)
 *
 * Mirrors the vibe_hue_lookup table in Postgres. Keep in sync.
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
 * State → saturation modulation.
 * Surging is fully saturated; Quiet drops to 50% (moderate desat,
 * vibe identity stays prominent); Unknown drops to 25% (visibly muted).
 */
export type StateLabel = 'Surging' | 'Packed' | 'Busy' | 'Lively' | 'Quiet' | 'Unknown';

export function stateToSaturation(state: StateLabel | string | null, vibeBaseSat: number): number {
  const multiplier = (() => {
    switch (state) {
      case 'Surging': return 1.0;
      case 'Packed':  return 0.92;
      case 'Busy':    return 0.85;
      case 'Lively':  return 0.70;
      case 'Quiet':   return 0.55;
      case 'Unknown':
      case null:
      case undefined: return 0.30;
      default:        return 0.55;
    }
  })();
  return Math.round(vibeBaseSat * multiplier);
}

/**
 * Capacity → lightness modulation.
 * Empty venues render slightly dark (35%); full venues render at 55%;
 * over-capacity nudges brighter (60%) to feel "lit up".
 * Returns a value safe to drop into an HSL string.
 */
export function capacityToLightness(capacityPct: number | null | undefined): number {
  if (capacityPct == null) return 45;
  const clamped = Math.min(1.2, Math.max(0, capacityPct));
  // Linear: 0 → 35, 1.0 → 55, 1.2 → 60
  if (clamped >= 1.0) return Math.round(55 + (clamped - 1.0) * 25);
  return Math.round(35 + clamped * 20);
}

/**
 * Master function. Produces an HSL string for any venue at any moment.
 * Pass the vibe hue ID, current state label, and capacity (0-1+).
 * Returns "hsl(degrees, sat%, light%)" ready for any CSS context.
 */
export function vibeToHsl(
  hueId: VibeHueId | null | undefined,
  state: StateLabel | string | null,
  capacityPct: number | null | undefined,
): string {
  if (hueId == null || !(hueId in HUE_BY_ID)) {
    // Unknown vibe — render as neutral grey
    return 'hsl(240, 8%, 60%)';
  }
  const hue = HUE_BY_ID[hueId as VibeHueId];
  const sat = stateToSaturation(state, hue.defaultSat);
  const light = capacityToLightness(capacityPct);
  return `hsl(${hue.degrees}, ${sat}%, ${light}%)`;
}

/**
 * Glow color for halos and shadows. Same hue, higher saturation,
 * mid-lightness, with alpha. Use in box-shadow and radial-gradient.
 */
export function vibeToGlow(
  hueId: VibeHueId | null | undefined,
  state: StateLabel | string | null,
  alpha = 0.5,
): string {
  if (hueId == null || !(hueId in HUE_BY_ID)) {
    return `rgba(150, 150, 170, ${alpha})`;
  }
  const hue = HUE_BY_ID[hueId as VibeHueId];
  const sat = Math.min(100, stateToSaturation(state, hue.defaultSat) + 15);
  return `hsla(${hue.degrees}, ${sat}%, 55%, ${alpha})`;
}

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
