import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, envReady } from '../lib/supabase';

export type LaunchCityKey = 'knoxville' | 'tampa' | 'st_petersburg';

export type DominantState = 'Quiet' | 'Lively' | 'Busy' | 'Packed' | 'Surging';

export interface CityAggregate {
  city: LaunchCityKey;
  cityName: string;
  totalVenues: number;
  activeCount: number;
  peopleOut: number;
  dominantState: DominantState;
  centerLat: number;
  centerLng: number;
  surgingCount: number;
  packedCount: number;
  busyCount: number;
  livelyCount: number;
  quietCount: number;
  avgConfidence: number;
}

interface UseCityAggregatesResult {
  aggregates: CityAggregate[];
  totalPeopleOut: number;
  loading: boolean;
  error: Error | null;
}

const CITY_NAMES: Record<LaunchCityKey, string> = {
  knoxville:     'Knoxville',
  tampa:         'Tampa',
  st_petersburg: 'St. Petersburg',
};

/** Coalesce realtime bursts into one re-fetch every 30 s. */
const REFETCH_DEBOUNCE_MS = 30_000;

interface CityAggregateRow {
  city: string;
  total_venues: number | null;
  active_count: number | null;
  people_out: number | null;
  dominant_state: string | null;
  center_lat: number | string | null;
  center_lng: number | string | null;
  surging_count: number | null;
  packed_count: number | null;
  busy_count: number | null;
  lively_count: number | null;
  quiet_count: number | null;
  avg_confidence: number | null;
}

function isLaunchCity(c: string): c is LaunchCityKey {
  return c === 'knoxville' || c === 'tampa' || c === 'st_petersburg';
}

function isDominantState(s: string | null | undefined): s is DominantState {
  return s === 'Quiet' || s === 'Lively' || s === 'Busy' || s === 'Packed' || s === 'Surging';
}

/**
 * Reads the `city_aggregates` SQL view and exposes per-city rollups
 * to the globe view + headline counter. Refreshes are debounced to
 * once every 30 s — the view is a roll-up, so minute-level precision
 * isn't worth the network chatter from the per-venue realtime burst.
 */
export function useCityAggregates(): UseCityAggregatesResult {
  const [aggregates, setAggregates] = useState<CityAggregate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const lastFetchAtRef = useRef(0);
  const pendingTimerRef = useRef<number | null>(null);
  const aliveRef = useRef(true);

  const doFetch = useCallback(async () => {
    if (!envReady) return;
    lastFetchAtRef.current = Date.now();

    const { data, error: err } = await supabase
      .from('city_aggregates')
      .select('city, total_venues, active_count, people_out, dominant_state, center_lat, center_lng, surging_count, packed_count, busy_count, lively_count, quiet_count, avg_confidence');

    if (!aliveRef.current) return;

    if (err) {
      console.warn('[useCityAggregates] fetch failed:', err.message);
      setError(new Error(err.message));
      setLoading(false);
      return;
    }

    const rows = (data as CityAggregateRow[]) ?? [];
    const next: CityAggregate[] = rows
      .filter(r => isLaunchCity(r.city))
      .map(r => ({
        city: r.city as LaunchCityKey,
        cityName: CITY_NAMES[r.city as LaunchCityKey],
        totalVenues:   Number(r.total_venues  ?? 0),
        activeCount:   Number(r.active_count  ?? 0),
        peopleOut:     Number(r.people_out    ?? 0),
        dominantState: isDominantState(r.dominant_state) ? r.dominant_state : 'Quiet',
        centerLat:     Number(r.center_lat),
        centerLng:     Number(r.center_lng),
        surgingCount:  Number(r.surging_count ?? 0),
        packedCount:   Number(r.packed_count  ?? 0),
        busyCount:     Number(r.busy_count    ?? 0),
        livelyCount:   Number(r.lively_count  ?? 0),
        quietCount:    Number(r.quiet_count   ?? 0),
        avgConfidence: Number(r.avg_confidence ?? 0),
      }));

    setAggregates(next);
    setError(null);
    setLoading(false);
  }, []);

  /** 30 s coalescing wrapper around doFetch. */
  const requestRefetch = useCallback(() => {
    if (pendingTimerRef.current !== null) return;
    const elapsed = Date.now() - lastFetchAtRef.current;
    if (elapsed >= REFETCH_DEBOUNCE_MS) {
      doFetch();
    } else {
      pendingTimerRef.current = window.setTimeout(() => {
        pendingTimerRef.current = null;
        doFetch();
      }, REFETCH_DEBOUNCE_MS - elapsed);
    }
  }, [doFetch]);

  // Initial fetch — bypass debounce so the globe overlay shows real
  // numbers immediately rather than empty zeros for up to 30 s.
  useEffect(() => {
    aliveRef.current = true;
    setLoading(true);
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

  // Realtime — coarse channel, debounced re-fetch
  useEffect(() => {
    if (!envReady) return;
    const channel = supabase
      .channel(`city-aggregates-rt-${Date.now()}`)
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

  const totalPeopleOut = aggregates.reduce((sum, a) => sum + a.peopleOut, 0);

  return { aggregates, totalPeopleOut, loading, error };
}
