/**
 * Places on Social home: the three cities plus one per active partner
 * World. Ordering, countdowns and per-device "seen" state for story rings.
 */

import type { CityKey } from './constants';
import type { SocialEvent } from './socialTypes';
import { SOCIAL_CITY_LABEL } from './socialTheme';
import { SOCIAL_CITIES, SOCIAL_CITY_GEO } from './socialGeo';
import { brandColor, type Brand } from './brands';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Events without an end time count as in progress for this long. */
const DEFAULT_LIVE_MS = 3 * HOUR;

export type PlaceKey = `city:${CityKey}` | `brand:${string}`;

export interface Place {
  key: PlaceKey;
  kind: 'city' | 'brand';
  city: CityKey | null;
  brand: Brand | null;
  name: string;
  /** CSS color (may be a var()). */
  color: string;
  center: [number, number];
  /** Not-yet-ended events, soonest first. */
  events: SocialEvent[];
}

export const CITY_CODE: Record<CityKey, string> = { tampa: 'TPA', st_petersburg: 'STP', knoxville: 'KNX' };

const endOf = (e: SocialEvent) => (e.end_time ? new Date(e.end_time).getTime() : new Date(e.start_time).getTime() + DEFAULT_LIVE_MS);
const startOf = (e: SocialEvent) => new Date(e.start_time).getTime();

export function isLive(e: SocialEvent, now: number): boolean {
  return !e.date_tba && startOf(e) <= now && now < endOf(e);
}

export function buildPlaces(events: SocialEvent[], brands: Brand[], now: number): Place[] {
  const open = events.filter(e => e.date_tba || endOf(e) > now).sort((a, b) => startOf(a) - startOf(b));
  const cities: Place[] = SOCIAL_CITIES.map(c => ({
    key: `city:${c}` as PlaceKey, kind: 'city', city: c, brand: null,
    name: SOCIAL_CITY_LABEL[c], color: `var(--social-accent-${c})`,
    center: SOCIAL_CITY_GEO[c].center,
    events: open.filter(e => e.city === c),
  }));
  const worlds: Place[] = brands.map(b => {
    const cs = b.cities.length ? b.cities : SOCIAL_CITIES;
    const pts = cs.map(c => SOCIAL_CITY_GEO[c].center);
    const center: [number, number] = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    return {
      key: `brand:${b.slug}` as PlaceKey, kind: 'brand', city: null, brand: b,
      name: `${b.name} World`, color: brandColor(b), center,
      events: open.filter(e => e.brand === b.slug),
    };
  });
  return [...cities, ...worlds];
}

export interface PlaceStatus {
  weekCount: number;
  /** In progress now, else the soonest dated event, else a Date TBA one. */
  next: SocialEvent | null;
  live: boolean;
}

export function placeStatus(p: Place, now: number): PlaceStatus {
  const horizon = now + 7 * DAY;
  const weekCount = p.events.filter(e => !e.date_tba && startOf(e) < horizon).length;
  const live = p.events.find(e => isLive(e, now)) ?? null;
  const dated = p.events.find(e => !e.date_tba && startOf(e) > now) ?? null;
  const tba = p.events.find(e => e.date_tba) ?? null;
  return { weekCount, next: live ?? dated ?? tba, live: !!live };
}

/** In progress first, then soonest next event, then Date TBA only, then empty. */
export function orderPlaces(places: Place[], now: number): PlaceKey[] {
  const rank = (p: Place): [number, number] => {
    const s = placeStatus(p, now);
    if (!s.next) return [3, 0];
    if (s.live) return [0, startOf(s.next)];
    if (s.next.date_tba) return [2, 0];
    return [1, startOf(s.next)];
  };
  return places
    .map((p, i) => ({ p, i, r: rank(p) }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.i - b.i)
    .map(x => x.p.key);
}

/** "starts in 2h 14m" · "starts in 3d 4h" · "starts Oct 23". */
export function countdown(e: SocialEvent, now: number): string {
  if (e.date_tba) return 'Date TBA';
  const ms = startOf(e) - now;
  if (ms < MIN) return 'starting now';
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  const m = Math.floor((ms % HOUR) / MIN);
  if (ms < HOUR) return `starts in ${m}m`;
  if (ms < DAY) return `starts in ${h}h ${m}m`;
  if (d < 7) return `starts in ${d}d ${h}h`;
  return `starts ${new Date(startOf(e)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

// ── Story rings: per-device, per-partner "last seen" ───────────────
const SEEN_KEY = (slug: string) => `social-seen:${slug}`;

export function lastSeen(slug: string): number | null {
  try {
    const v = localStorage.getItem(SEEN_KEY(slug));
    return v ? Number(v) : null;
  } catch { return null; }
}

export function markSeen(slug: string, at: number = Date.now()): void {
  try { localStorage.setItem(SEEN_KEY(slug), String(at)); } catch { /* not persisted */ }
}

/** Bright ring: events created since this device last opened the World.
 *  Never opened → everything is new. */
export function hasNew(events: SocialEvent[], slug: string): boolean {
  const seen = lastSeen(slug);
  if (seen === null) return events.length > 0;
  return events.some(e => !!e.created_at && new Date(e.created_at).getTime() > seen);
}
