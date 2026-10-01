import { supabase, envReady } from './supabase';
import { normalizeEstimates } from './estimates';
import type { VenueWithEstimate } from '../hooks/useVenuesInBounds';

/**
 * Venue + estimate loading shared by useVenuesInBounds and main.tsx.
 *
 *  • prefetchVenues() is called from main.tsx before React mounts, so
 *    the one venues query is already in flight while the bundle
 *    evaluates, React renders and Mapbox loads its style.
 *  • The last good result is cached on device; useVenuesInBounds seeds
 *    its initial state from it so bubbles paint with numbers on the
 *    first frame, then the network result replaces it.
 */

const VENUE_COLUMNS = 'id, created_at, name, slug, city, category, address, lat, lng, image_url, deals, hours, instagram, vibe_tagline, has_live_cam, live_cam_url, cam_coming_soon, is_active, sort_order, capacity, is_clicker_live, staff_code, phone, website, description, rating, review_count, tonight_special, special_updated_at, cover_charge, featured, featured_label, loyalty_active, nfc_tag_id, nfc_required, vibe_hue_baseline, is_hub, hub_subtitle, tenant_of';
const ESTIMATE_COLUMNS = 'estimate, estimate_low, estimate_high, confidence_pct, capacity_pct, state_label, trend, trend_rate, computed_at, source_breakdown, delta_pct, expected_pct';
const LAUNCH_MARKETS = ['knoxville', 'tampa', 'st_petersburg'];

export interface VenuesResult {
  data: VenueWithEstimate[] | null;
  error: unknown;
}

export async function fetchVenuesWithEstimates(): Promise<VenuesResult> {
  if (!envReady) return { data: null, error: null };
  const { data, error } = await supabase
    .from('venues')
    .select(`${VENUE_COLUMNS}, headcount_estimates(${ESTIMATE_COLUMNS})`)
    .in('city', LAUNCH_MARKETS)
    .or('is_active.eq.true,is_active.is.null')
    .order('sort_order');
  if (error) return { data: null, error };
  const rows = ((data as unknown as Record<string, unknown>[]) ?? []).map(row => ({
    ...row,
    headcount_estimates: normalizeEstimates(row.headcount_estimates),
  })) as VenueWithEstimate[];
  return { data: rows, error: null };
}

// ── Prefetch (started before React mounts) ──────────────────────
let prefetch: Promise<VenuesResult> | null = null;

export function prefetchVenues(): void {
  if (prefetch || !envReady) return;
  prefetch = fetchVenuesWithEstimates();
}

/**
 * The in-flight / settled prefetch, if any. Not cleared on read so that
 * StrictMode's double-mount shares it; cleared by releasePrefetch() once
 * a mounted hook has applied the result.
 */
export function takePrefetch(): Promise<VenuesResult> | null {
  return prefetch;
}

export function releasePrefetch(): void {
  prefetch = null;
}

// ── Device cache ────────────────────────────────────────────────
const CACHE_KEY = 'venuu:venues-cache:v1';

interface CacheShape {
  savedAt: number;
  venues: VenueWithEstimate[];
}

export function readVenuesCache(): VenueWithEstimate[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheShape;
    if (!Array.isArray(parsed?.venues) || parsed.venues.length === 0) return null;
    return parsed.venues.map(v => ({ ...v, headcount_estimates: normalizeEstimates(v.headcount_estimates) }));
  } catch {
    return null;
  }
}

/** Persist off the critical path (idle time), so stringifying ~100KB
 *  never lands in the same frame as the map's entrance animation. */
export function writeVenuesCache(venues: VenueWithEstimate[]): void {
  const run = () => writeVenuesCacheNow(venues);
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 2000 });
  } else {
    setTimeout(run, 500);
  }
}

function writeVenuesCacheNow(venues: VenueWithEstimate[]): void {
  try {
    const payload: CacheShape = {
      savedAt: Date.now(),
      venues: venues.map(v => {
        if (!v.cached) return v;
        const copy = { ...v };
        delete copy.cached;
        return copy;
      }),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / private mode — the cache is an optimisation only.
  }
}
