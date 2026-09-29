import type { SocialEvent } from './socialTypes';
import { SUN_BRAND_SLUG } from './brands';

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


// Event covers: which procedural art an event gets (see EventCover).
export type CoverKind = 'sunrise' | 'route' | 'night' | 'ivory' | 'community';

export function coverKind(ev: SocialEvent): CoverKind {
  if (ev.brand === SUN_BRAND_SLUG) return 'sunrise';
  switch (ev.category) {
    case 'run_club': return 'route';
    case 'nightlife': return 'night';
    case 'pop_up': return 'ivory';
    default: return 'community';
  }
}


/** Horizontal parallax for covers: each card's art shifts with its offset
 *  from the carousel's left edge. Off under reduced motion. */
export function applyCarouselParallax(el: HTMLElement | null, reduced: boolean): void {
  if (!el || reduced) return;
  const box = el.getBoundingClientRect();
  for (const card of Array.from(el.children) as HTMLElement[]) {
    const r = card.getBoundingClientRect();
    if (!r.width) continue;
    const offset = (r.left - box.left - 16) / box.width;   // 0 = snapped
    card.style.setProperty('--parallax', `${(-offset * 24).toFixed(1)}px`);
  }
}

