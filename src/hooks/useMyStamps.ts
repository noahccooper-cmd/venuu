import { useCallback, useEffect, useState } from 'react';
import { supabase, envReady } from '../lib/supabase';

/**
 * useMyStamps — one entry per venue in the user's city. Visited
 * venues carry firstVisited + visitCount > 0 (full-color stamps);
 * unvisited venues are returned with visited=false (faded outlines)
 * so the user sees the gap as a goal to fill.
 *
 * v2: reads from user_visits (the confirmed-visit source of truth)
 * instead of loyalty_visits. user_visits.user_id references
 * profiles.id — pass profileId here. Stamps now light up from any
 * source: passive presence, NFC tap, cover purchase, or completed
 * plan stop.
 *
 * "First visited" uses MIN(night_of) within the user_visits rows
 * for each venue.
 */

export interface Stamp {
  venueId: string;
  venueName: string;
  city: string;
  firstVisited: string | null;   // YYYY-MM-DD, null for unvisited
  visitCount: number;            // 0 for unvisited
  visited: boolean;
}

export interface UseMyStampsResult {
  stamps: Stamp[];               // visited first (recent → old), then unvisited
  visitedCount: number;
  cityTotal: number;
  loading: boolean;
  refetch: () => Promise<void>;
}

interface RawUserVisitRow {
  venue_id: string;
  night_of: string;
  venues: { name: string; city: string } | null;
}

interface RawCityVenue {
  id: string;
  name: string;
  city: string;
  sort_order: number | null;
}

export function useMyStamps(profileId: string | null, city: string | null): UseMyStampsResult {
  const [stamps, setStamps] = useState<Stamp[]>([]);
  const [visitedCount, setVisitedCount] = useState(0);
  const [cityTotal, setCityTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!envReady || !profileId || !city) {
      setStamps([]);
      setVisitedCount(0);
      setCityTotal(0);
      setLoading(false);
      return;
    }

    // Run both queries in parallel — the city catalog rarely changes,
    // and a heavy user has < 2000 user_visits rows (one per night × venue).
    const [visitsRes, venuesRes] = await Promise.all([
      supabase
        .from('user_visits')
        .select('venue_id, night_of, venues(name, city)')
        .eq('user_id', profileId)
        .order('night_of', { ascending: false })
        .limit(2000),
      supabase
        .from('venues')
        .select('id, name, city, sort_order')
        .eq('city', city)
        .eq('is_active', true)
        .order('sort_order', { ascending: true, nullsFirst: false }),
    ]);

    if (visitsRes.error) {
      console.warn('[my_stamps] visits fetch failed:', visitsRes.error.message);
    }
    if (venuesRes.error) {
      console.warn('[my_stamps] venues fetch failed:', venuesRes.error.message);
    }

    const visitRows = (visitsRes.data ?? []) as unknown as RawUserVisitRow[];
    const cityVenues = (venuesRes.data ?? []) as unknown as RawCityVenue[];

    // Aggregate user_visits per venue. user_visits has UNIQUE
    // (user_id, venue_id, night_of) — one row per night — so the
    // count here is "distinct nights at this venue".
    const byVenue = new Map<string, Stamp>();
    for (const row of visitRows) {
      const venueId = row.venue_id;
      const name = row.venues?.name ?? 'Unknown';
      const venueCity = row.venues?.city ?? '';
      const night = row.night_of;
      const existing = byVenue.get(venueId);
      if (existing) {
        existing.visitCount += 1;
        if (existing.firstVisited && night < existing.firstVisited) {
          existing.firstVisited = night;
        }
      } else {
        byVenue.set(venueId, {
          venueId,
          venueName: name,
          city: venueCity,
          firstVisited: night,
          visitCount: 1,
          visited: true,
        });
      }
    }

    // Visited stamps for the user's current city, sorted by most-
    // recently-first-discovered.
    const visitedInCity: Stamp[] = [...byVenue.values()]
      .filter(s => s.city === city)
      .sort((a, b) => (b.firstVisited ?? '').localeCompare(a.firstVisited ?? ''));

    const visitedIds = new Set(visitedInCity.map(s => s.venueId));
    const unvisitedInCity: Stamp[] = cityVenues
      .filter(v => !visitedIds.has(v.id))
      .map(v => ({
        venueId: v.id,
        venueName: v.name,
        city: v.city,
        firstVisited: null,
        visitCount: 0,
        visited: false,
      }));

    setStamps([...visitedInCity, ...unvisitedInCity]);
    setVisitedCount(visitedInCity.length);
    setCityTotal(cityVenues.length);
    setLoading(false);
  }, [profileId, city]);

  useEffect(() => {
    setLoading(true);
    refetch();
  }, [refetch]);

  // Realtime — a fresh user_visits insert (passive promotion, NFC,
  // cover, plan-stop) should flip a faded outline into a full stamp
  // without a manual reload.
  useEffect(() => {
    if (!envReady || !profileId) return;
    const channel = supabase
      .channel(`my_stamps_rt:${profileId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_visits', filter: `user_id=eq.${profileId}` },
        () => { void refetch(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profileId, refetch]);

  return { stamps, visitedCount, cityTotal, loading, refetch };
}
