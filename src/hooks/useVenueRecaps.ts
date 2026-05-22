import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase, envReady } from '../lib/supabase';
import { getNightOf } from '../lib/utils';
import type { VenueRecap } from '../lib/types';

export function useVenueRecaps(venueId: string | null, username?: string) {
  const [recaps, setRecaps] = useState<VenueRecap[]>([]);
  const nightOf = getNightOf();
  // Track IDs we already have to avoid realtime duplicates
  const knownIds = useRef(new Set<string>());

  // Whether the current user already captured a moment at this venue (lifetime)
  const hasUserRecapped = useMemo(() => {
    if (!username) return false;
    return recaps.some(r => r.username === username);
  }, [recaps, username]);

  // Fetch tonight's recaps for this venue
  useEffect(() => {
    if (!envReady || !venueId) {
      setRecaps([]);
      knownIds.current.clear();
      return;
    }

    supabase
      .from('venue_recaps')
      .select('*')
      .eq('venue_id', venueId)
      .eq('day_of', nightOf)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (error) {
          console.error('[recap] Fetch error:', error.message);
          return;
        }
        const rows = (data as VenueRecap[]) ?? [];
        knownIds.current = new Set(rows.map(r => r.id));
        setRecaps(rows);
      });
  }, [venueId, nightOf]);

  // Real-time subscription for new recaps from OTHER users
  useEffect(() => {
    if (!envReady || !venueId) return;

    const channel = supabase
      .channel(`recaps-${venueId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'venue_recaps',
          filter: `venue_id=eq.${venueId}`,
        },
        (payload) => {
          const row = payload.new as VenueRecap;
          if (row.day_of !== nightOf) return;
          if (knownIds.current.has(row.id)) return;
          knownIds.current.add(row.id);
          setRecaps(prev => [row, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [venueId, nightOf]);

  const submitRecap = useCallback(async () => {
    // Direct recap submission is deprecated. Moments are submitted
    // via the submit_moment RPC, which requires a photo_url + hue.
    // PROMPT 43 wires this up with the camera + storage upload flow.
    throw new Error('submitRecap is deprecated — use the moments capture flow');
  }, []);

  return {
    recaps,
    submitRecap,
    hasUserRecapped,
  };
}
