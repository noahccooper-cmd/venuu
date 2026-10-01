/**
 * Posting a Social event: client checks (mirroring 00077's guard), the
 * Supabase insert, and friendly copy for every error the database can
 * return. Demo builds write to the local demo store instead.
 */

import type { CityKey } from './constants';
import type { SocialCategory, SocialEvent } from './socialTypes';
import type { Brand } from './brands';
import { supabase, mapboxToken } from './supabase';
import { SOCIAL_DEMO } from './socialMode';
import { addDemoEvents } from './socialDemoStore';
import { SOCIAL_CITY_GEO, distanceKm, nearestCity } from './socialGeo';

const HOUR = 3_600_000;
const WEEKLY_OCCURRENCES = 8;
/** Farther than this from every Social city → unsupported. */
const MAX_CITY_KM = 70;
export const DESCRIPTION_MAX = 280;
export const TITLE_MAX = 80;

export interface PostPlace {
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** null: outside every Social city (unsupported). */
  city: CityKey | null;
}

export interface PostDraft {
  title: string;
  category: SocialCategory;
  description: string;
  dateTba: boolean;
  /** Local start (ignored when dateTba). */
  start: Date | null;
  hours: number;
  repeatsWeekly: boolean;
  place: PostPlace | null;
  brandSlug: string | null;
  photo: File | null;
  /** Object URL for the Look preview. */
  photoPreview: string | null;
}

export type PostErrorCode =
  | 'rate_limited' | 'objectionable_content' | 'terms_required' | 'posting_banned' | 'unsupported_city'
  | 'date_tba_hosts_only' | 'partner_fields_hosts_only' | 'too_long' | 'in_past' | 'signed_out' | 'network' | 'unknown';

export const POST_ERROR_COPY: Record<PostErrorCode, string> = {
  rate_limited: 'You’ve posted 3 events in the last day. Try again tomorrow.',
  objectionable_content: 'Some words in your title or description aren’t allowed. Please reword it.',
  terms_required: 'Please accept the posting rules first.',
  posting_banned: 'Your account can’t post events right now.',
  unsupported_city: 'Social is in Tampa, St. Pete and Knoxville for now. Pick a spot in one of those.',
  date_tba_hosts_only: 'Only hosts can post without a date. Pick a date and time.',
  partner_fields_hosts_only: 'Only hosts can add a partner or repeat weekly.',
  too_long: `Keep the description under ${DESCRIPTION_MAX} characters.`,
  in_past: 'Pick a time later than now.',
  signed_out: 'Sign in to post an event.',
  network: 'Couldn’t reach Venuu. Check your connection and try again.',
  unknown: 'Something went wrong posting that. Please try again.',
};

// Same whole-word list as public.social_text_is_clean (00077). Keep in sync.
const BLOCKED = [
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bullshit', 'cunt', 'bitch',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'kike', 'spic', 'chink', 'tranny',
  'whore', 'slut', 'rape', 'rapist', 'pedo', 'pedophile',
];
const BLOCKED_RE = new RegExp(`\\b(${BLOCKED.join('|')})\\b`, 'i');
export const textIsClean = (s: string) => !BLOCKED_RE.test(s);

export function cityFor(lng: number, lat: number): CityKey | null {
  const c = nearestCity([lng, lat]);
  return distanceKm([lng, lat], SOCIAL_CITY_GEO[c].center) <= MAX_CITY_KM ? c : null;
}

/** Client-side check before submit — the server re-checks everything. */
export function checkDraft(d: PostDraft, canHost: boolean): PostErrorCode | null {
  if (!textIsClean(d.title) || !textIsClean(d.description)) return 'objectionable_content';
  if (d.description.length > DESCRIPTION_MAX) return 'too_long';
  if (d.dateTba && !canHost) return 'date_tba_hosts_only';
  if ((d.brandSlug || d.repeatsWeekly) && !canHost) return 'partner_fields_hosts_only';
  if (!d.dateTba && (!d.start || d.start.getTime() + d.hours * HOUR <= Date.now())) return 'in_past';
  if (d.place && !d.place.city) return 'unsupported_city';
  return null;
}

/** Map a PostgREST / storage error to a code (guard codes are the messages). */
export function mapPostError(err: { message?: string; code?: string } | null | undefined): PostErrorCode {
  const m = `${err?.message ?? ''} ${err?.code ?? ''}`;
  const known: PostErrorCode[] = ['rate_limited', 'objectionable_content', 'terms_required', 'posting_banned',
    'unsupported_city', 'date_tba_hosts_only', 'partner_fields_hosts_only'];
  for (const k of known) if (m.includes(k)) return k;
  if (m.includes('events_social_description_len')) return 'too_long';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'network';
  return 'unknown';
}

function starts(d: PostDraft): Date[] {
  const first = d.dateTba ? new Date(Date.now() + 330 * 24 * HOUR) : d.start!;
  const n = d.repeatsWeekly && !d.dateTba ? WEEKLY_OCCURRENCES : 1;
  // Calendar-day arithmetic (not +7×24h) keeps the time right across DST.
  return Array.from({ length: n }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i * 7, first.getHours(), first.getMinutes()));
}

export type PostResult = { ok: true; id: string; verified: boolean } | { ok: false; code: PostErrorCode };

export async function submitPost(d: PostDraft, ctx: { profileId: string | null; brands: Brand[]; isAdmin: boolean; hostName: string }): Promise<PostResult> {
  if (!d.place?.city) return { ok: false, code: 'unsupported_city' };
  const place = { ...d.place, city: d.place.city };
  const dates = starts(d);
  const end = (s: Date) => new Date(s.getTime() + (d.dateTba ? 365 * 24 * HOUR : d.hours * HOUR));

  if (SOCIAL_DEMO) {
    const stamp = Date.now();
    const series = dates.length > 1 ? `demo-series-${stamp}` : null;
    const rows: SocialEvent[] = dates.map((s, i) => ({
      id: `demo-post-${stamp}-${i}`, city: place.city, surface: 'social', category: d.category, brand: d.brandSlug,
      title: d.title.trim(), host_name: ctx.hostName, external_venue_name: place.name, address: place.address,
      latitude: place.lat, longitude: place.lng, start_time: s.toISOString(), end_time: end(s).toISOString(),
      expires_at: end(s).toISOString(), series_id: series, description: d.description.trim() || null,
      date_tba: d.dateTba, photo_url: d.photoPreview, verification: ctx.isAdmin ? 'verified' : 'community',
      created_at: new Date().toISOString(), going_count: 0,
      host_profile_id: 'demo-me',   // DEMO_ME (socialModeration): owner actions work on demo posts
    }));
    addDemoEvents(rows);
    return { ok: true, id: rows[0].id, verified: ctx.isAdmin };
  }

  if (!ctx.profileId || !supabase) return { ok: false, code: 'signed_out' };
  try {
    let imageUrl: string | null = null;
    if (d.photo) {
      const ext = (d.photo.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const path = `${ctx.profileId}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from('event-photos').upload(path, d.photo, { contentType: d.photo.type, upsert: false });
      if (up.error) return { ok: false, code: mapPostError(up.error) };
      imageUrl = supabase.storage.from('event-photos').getPublicUrl(path).data.publicUrl;
    }
    const brandId = d.brandSlug ? ctx.brands.find(b => b.slug === d.brandSlug)?.id ?? null : null;
    const series = dates.length > 1 ? crypto.randomUUID() : null;
    const rows = dates.map(s => ({
      surface: 'social', category: d.category, title: d.title.trim(), description: d.description.trim() || null,
      city: place.city, latitude: place.lat, longitude: place.lng, external_venue_name: place.name, address: place.address,
      start_time: s.toISOString(), end_time: end(s).toISOString(), date_tba: d.dateTba, series_id: series,
      brand_id: brandId, host_profile_id: ctx.profileId, verification: ctx.isAdmin ? 'verified' : 'community', image_url: imageUrl,
    }));
    const { data, error } = await supabase.from('events').insert(rows).select('id, verification');
    if (error || !data?.length) return { ok: false, code: mapPostError(error) };
    const first = data[0] as { id: string; verification: string };
    return { ok: true, id: first.id, verified: first.verification === 'verified' };
  } catch (e) {
    return { ok: false, code: mapPostError(e as Error) };
  }
}

// ── Posting rules (first post) ──
const DEMO_TERMS_KEY = 'social-demo-terms';
export async function acceptTerms(profileId: string | null): Promise<boolean> {
  if (SOCIAL_DEMO) { try { localStorage.setItem(DEMO_TERMS_KEY, '1'); } catch { /* session only */ } return true; }
  if (!profileId || !supabase) return false;
  const { error } = await supabase.from('profiles').update({ accepted_posting_terms_at: new Date().toISOString() }).eq('id', profileId);
  return !error;
}
export function demoTermsAccepted(): boolean {
  try { return localStorage.getItem(DEMO_TERMS_KEY) === '1'; } catch { return false; }
}

// ── Where: Mapbox geocoding, limited to the Social metros ──
// Two bounding boxes (Tampa Bay incl. Pinellas, Knoxville) searched in
// parallel, so a name like "St. Pete Pier" never resolves to another state.
const METRO_BBOXES: [number, number, number, number][] = [
  [-82.95, 27.55, -82.15, 28.25],   // Tampa Bay
  [-84.25, 35.80, -83.65, 36.15],   // Knoxville
];

export async function searchPlaces(q: string, near: CityKey): Promise<PostPlace[]> {
  if (!q.trim() || !mapboxToken) return [];
  const [lng, lat] = SOCIAL_CITY_GEO[near].center;
  const one = async (bbox: number[]) => {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q.trim())}.json`
      + `?access_token=${mapboxToken}&proximity=${lng},${lat}&bbox=${bbox.join(',')}&country=us&types=poi,address,neighborhood,place&limit=5`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json() as { features?: { text: string; place_name: string; center: [number, number] }[] };
    return json.features ?? [];
  };
  const all = (await Promise.all(METRO_BBOXES.map(one))).flat();
  const seen = new Set<string>();
  return all
    .filter(f => { const k = f.place_name; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(f => ({ name: f.text, address: f.place_name, lng: f.center[0], lat: f.center[1], city: cityFor(f.center[0], f.center[1]) }))
    .sort((a, b) => distanceKm([lng, lat], [a.lng, a.lat]) - distanceKm([lng, lat], [b.lng, b.lat]))
    .slice(0, 6);
}
