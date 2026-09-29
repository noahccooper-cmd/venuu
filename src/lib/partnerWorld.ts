import type { SocialEvent } from './socialTypes';

// Partner World layout (px). The Social root already ends above the tab
// bar + home indicator, so "bottom" is clear of both.
export const WORLD_LAYOUT = {
  BAR_GAP: 12,
  BAR_H: 52,
  SWITCH_GAP: 8,
  SWITCH_H: 44,
  CARD_H: 128,
  CAROUSEL_BOTTOM: 12,
  CARD_GAP: 12,
} as const;

const L = WORLD_LAYOUT;
/** Height the map must keep clear at the top (below the app header). */
export const WORLD_TOP_PX = L.BAR_GAP + L.BAR_H + L.SWITCH_GAP + L.SWITCH_H;
/** Height the map must keep clear at the bottom (the carousel). */
export const WORLD_BOTTOM_PX = L.CAROUSEL_BOTTOM + L.CARD_H;

/** Partner World card order: dated events by start, Date TBA last. */
export function worldOrder(a: SocialEvent, b: SocialEvent): number {
  if (!!a.date_tba !== !!b.date_tba) return a.date_tba ? 1 : -1;
  return a.start_time.localeCompare(b.start_time);
}

// 21+ gate: remembered per device, per brand.
const AGE_KEY = (slug: string) => `social-age-ok:${slug}`;
export function ageConfirmed(slug: string): boolean {
  try { return localStorage.getItem(AGE_KEY(slug)) === '1'; } catch { return false; }
}
export function rememberAge(slug: string): void {
  try { localStorage.setItem(AGE_KEY(slug), '1'); } catch { /* this session only */ }
}

