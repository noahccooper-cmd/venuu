import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, envReady } from '../lib/supabase';
import { getNightOf } from '../lib/utils';
import { CITIES, type CityKey } from '../lib/constants';
import { hapticLight } from '../lib/haptics';
import type { Headcount } from '../lib/types';

export function useHeadcounts(city: CityKey) {
  const [headcounts, setHeadcounts] = useState<Record<string, Headcount>>({});
  const [loading, setLoading] = useState(true);
  const [pulsedVenueId, setPulsedVenueId] = useState<string | null>(null);
  const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const nightOf = getNightOf();

  // Compute the previous calendar night (not the same as nightOf when before 5am —
  // in that case getNightOf already returns yesterday, so we go one further back).
  const prevNightOf = (() => {
    const d = new Date(nightOf + 'T12:00:00'); // parse as local noon to avoid DST edge
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dy}`;
  })();

  const fetchHeadcounts = useCallback(async () => {
    if (!envReady) {
      setLoading(false);
      return;
    }

    const dbCity = CITIES[city].dbCity;
    console.debug('[headcounts] Fetching for night_of:', nightOf, '+ fallback:', prevNightOf, 'city:', dbCity);

    // Fetch both tonight AND the previous night in a single query.
    // This ensures counts persist across the night boundary (e.g. at 10am the
    // map still shows last night's numbers until bouncers update tonight's).
    const { data, error } = await supabase
      .from('headcounts')
      .select('*')
      .ilike('city', `%${dbCity}%`)
      .in('night_of', [nightOf, prevNightOf]);

    if (error) {
      console.warn('[headcounts] Fetch error:', error.message);
      setLoading(false);
      return;
    }

    if (data) {
      // Merge: previous night loaded first, tonight's rows override.
      // This means venues that had a count last night keep showing it
      // until a bouncer explicitly sets a new count tonight.
      const map: Record<string, Headcount> = {};
      let withCount = 0;

      // Previous night first (lower priority)
      (data as Headcount[])
        .filter(r => r.night_of === prevNightOf && r.current_count > 0)
        .forEach(r => { map[r.venue_id] = r; });

      // Tonight overrides (higher priority — even if count is 0)
      (data as Headcount[])
        .filter(r => r.night_of === nightOf)
        .forEach(r => { map[r.venue_id] = r; });

      Object.values(map).forEach(r => { if (r.current_count > 0) withCount++; });
      setHeadcounts(map);
      console.debug(`[headcounts] Fetch complete: ${data.length} rows total, ${withCount} venues with counts`);
    } else {
      console.debug('[headcounts] No data returned');
    }
    setLoading(false);
  }, [city, nightOf, prevNightOf]);

  useEffect(() => {
    fetchHeadcounts();
  }, [fetchHeadcounts]);

  // Real-time subscription — unique channel name for clean reconnect
  useEffect(() => {
    if (!envReady) return;

    const channelName = `headcounts-rt-${city}-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'headcounts',
        },
        (payload) => {
          if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            const row = payload.new as Headcount;
            // Only process rows for our city (case-insensitive partial match)
            if (!row.city.toLowerCase().includes(CITIES[city].dbCity)) return;
            // Only accept tonight's rows via realtime — stale rows from previous
            // nights are handled by the initial fallback fetch, not live updates
            if (row.night_of !== nightOf) return;
            console.debug(`[headcounts] Realtime update: ${row.venue_id} count=${row.current_count} is_live=${row.is_live}`);
            hapticLight();
            setHeadcounts(prev => ({ ...prev, [row.venue_id]: row }));

            // Trigger dot pulse
            setPulsedVenueId(row.venue_id);
            if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
            pulseTimeoutRef.current = setTimeout(() => setPulsedVenueId(null), 600);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
    };
  }, [city, nightOf]);

  // Refetch when app is foregrounded (tab becomes visible after backgrounding)
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) fetchHeadcounts();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [fetchHeadcounts]);

  // Listen for direct headcount updates from Portal (same pattern as cover charge sync)
  useEffect(() => {
    const handler = (e: Event) => {
      const { venueId, currentCount, isLive } = (e as CustomEvent).detail;
      setHeadcounts(prev => {
        const existing = prev[venueId];
        if (!existing) {
          // First ENTER of the night — create a synthetic headcount entry
          return {
            ...prev,
            [venueId]: {
              id: '',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              venue_id: venueId,
              city: CITIES[city].dbCity,
              night_of: nightOf,
              current_count: currentCount,
              peak_count: currentCount,
              last_updated_by: null,
              is_live: isLive ?? true,
            } as Headcount,
          };
        }
        return {
          ...prev,
          [venueId]: {
            ...existing,
            current_count: currentCount,
            is_live: isLive,
            updated_at: new Date().toISOString(),
            peak_count: Math.max(existing.peak_count, currentCount),
          },
        };
      });

      // Trigger dot pulse
      setPulsedVenueId(venueId);
      if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
      pulseTimeoutRef.current = setTimeout(() => setPulsedVenueId(null), 600);
    };
    window.addEventListener('headcount-update', handler);
    return () => window.removeEventListener('headcount-update', handler);
  }, [city, nightOf]);

  const getVenueHeadcount = useCallback((venueId: string) => {
    return headcounts[venueId] ?? null;
  }, [headcounts]);

  const getLiveTotalCount = useCallback(() => {
    return Object.values(headcounts).reduce((sum, h) => sum + h.current_count, 0);
  }, [headcounts]);

  return {
    headcounts,
    loading,
    pulsedVenueId,
    getVenueHeadcount,
    getLiveTotalCount,
    refetch: fetchHeadcounts,
  };
}
