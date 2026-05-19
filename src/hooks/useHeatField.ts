import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeatureCollection, Point } from 'geojson';
import { supabase, envReady } from '../lib/supabase';

/**
 * Heat-field point properties — mirrors the `heat_points` SQL view
 * (migration 00021). Mapbox heatmap + circle layers read these
 * properties via `['get', '<key>']` paint expressions.
 */
export interface HeatPointProps {
  venue_id: string;
  name: string;
  city: string;
  estimate: number;
  confidence_pct: number;
  capacity_pct: number;
  state_label: string;
  heat_weight: number;
  computed_at: string | null;
}

interface HeatPointRow extends HeatPointProps {
  lat: number;
  lng: number;
  capacity: number | null;
}

const EMPTY_FC: FeatureCollection<Point, HeatPointProps> = {
  type: 'FeatureCollection',
  features: [],
};

const THROTTLE_MS = 5_000;
const LAUNCH_MARKETS = ['knoxville', 'tampa', 'st_petersburg'] as const;

/**
 * Reads the `heat_points` view across ALL launch markets and returns a
 * GeoJSON FeatureCollection ready to hand to a Mapbox source. Subscribes
 * to `headcount_estimates` realtime events and re-fetches on change,
 * throttled to at most one fetch every 5 seconds.
 *
 * The heat field is intentionally GLOBAL — when the city dropdown
 * changes, only the camera moves, but the heat across every venuu city
 * keeps glowing. This lets a user zoomed out over the southeast see
 * Tampa, St. Pete, and Knoxville simultaneously instead of one at a
 * time.
 *
 * `currentCity` is accepted but not used for filtering today; it's
 * preserved in the signature so we can reintroduce bounds-aware
 * culling without a public-API change once we scale past hundreds of
 * venues per market.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useHeatField(_currentCity: string) {
  const [geojson, setGeojson] = useState<FeatureCollection<Point, HeatPointProps>>(EMPTY_FC);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const lastFetchAtRef = useRef(0);
  const pendingTimerRef = useRef<number | null>(null);
  const aliveRef = useRef(true);

  const firstFetchLoggedRef = useRef(false);

  const doFetch = useCallback(async () => {
    if (!envReady) return;
    lastFetchAtRef.current = Date.now();

    const { data, error } = await supabase
      .from('heat_points')
      .select('venue_id, name, city, lat, lng, capacity, estimate, confidence_pct, capacity_pct, state_label, heat_weight, computed_at')
      .in('city', LAUNCH_MARKETS as unknown as string[]);

    if (!aliveRef.current) return;

    if (error) {
      console.warn('[useHeatField] fetch failed:', error.message);
      setLoading(false);
      return;
    }

    const rows = (data as HeatPointRow[]) ?? [];

    const fc: FeatureCollection<Point, HeatPointProps> = {
      type: 'FeatureCollection',
      features: rows.map(r => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
        properties: {
          venue_id: r.venue_id,
          name: r.name,
          city: r.city,
          estimate: r.estimate,
          confidence_pct: r.confidence_pct,
          capacity_pct: r.capacity_pct,
          state_label: r.state_label,
          heat_weight: r.heat_weight,
          computed_at: r.computed_at,
        },
      })),
    };

    setGeojson(fc);
    setLoading(false);
    setLastUpdated(new Date());

    if (!firstFetchLoggedRef.current) {
      firstFetchLoggedRef.current = true;
      const features = fc.features;
      const distinctCities = new Set(features.map(f => f.properties.city)).size;
      console.log('[heatfield] global heat: ' + features.length + ' points across ' + distinctCities + ' cities');
    }
  }, []);

  /** Public re-fetch with 5s throttle + coalescing. */
  const requestRefetch = useCallback(() => {
    if (pendingTimerRef.current !== null) return; // already scheduled

    const elapsed = Date.now() - lastFetchAtRef.current;
    if (elapsed >= THROTTLE_MS) {
      doFetch();
    } else {
      pendingTimerRef.current = window.setTimeout(() => {
        pendingTimerRef.current = null;
        doFetch();
      }, THROTTLE_MS - elapsed);
    }
  }, [doFetch]);

  // ─── Initial fetch (one-shot for the lifetime of the hook) ──
  useEffect(() => {
    aliveRef.current = true;
    setLoading(true);
    // Bypass the throttle on first mount so the user sees the field
    // immediately rather than waiting up to 5s.
    lastFetchAtRef.current = 0;
    doFetch();
    return () => {
      aliveRef.current = false;
      if (pendingTimerRef.current !== null) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, [doFetch]);

  // ─── Realtime subscription on headcount_estimates ───────────
  // One coarse channel watching the whole table — the 5s throttle
  // collapses the ~78-event-per-minute fusion-cycle burst into one
  // re-fetch.
  useEffect(() => {
    if (!envReady) return;

    const channel = supabase
      .channel(`heat-field-global-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'headcount_estimates' },
        () => requestRefetch()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [requestRefetch]);

  return { geojson, loading, lastUpdated };
}
