import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase, envReady } from '../lib/supabase';
import { getNightOf } from '../lib/utils';
import { recordSignal } from '../lib/signals';
import type { VenueRecap } from '../lib/types';

export function useVenueRecaps(venueId: string | null, username?: string) {
  const [recaps, setRecaps] = useState<VenueRecap[]>([]);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [totalRecaps, setTotalRecaps] = useState(0);
  const nightOf = getNightOf();
  // Track IDs we already have to avoid realtime duplicates
  const knownIds = useRef(new Set<string>());

  // Whether the current user already posted tonight
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

  // Fetch all-time rating stats for this venue
  useEffect(() => {
    if (!envReady || !venueId) {
      setAvgRating(null);
      setTotalRecaps(0);
      return;
    }

    supabase
      .from('venue_recaps')
      .select('stars')
      .eq('venue_id', venueId)
      .then(({ data, error }) => {
        if (error || !data || data.length === 0) {
          setAvgRating(null);
          setTotalRecaps(0);
          return;
        }
        const rows = data as { stars: number }[];
        const sum = rows.reduce((acc, r) => acc + r.stars, 0);
        setAvgRating(Math.round((sum / rows.length) * 10) / 10);
        setTotalRecaps(rows.length);
      });
  }, [venueId, recaps.length]); // re-fetch when new recaps are added

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

  const submitRecap = useCallback(async (uname: string, body: string, stars: number) => {
    if (!envReady || !venueId || !body.trim() || stars < 1) return;

    const trimmed = body.trim().slice(0, 200);
    const optimisticId = crypto.randomUUID();
    knownIds.current.add(optimisticId);

    const { data, error } = await supabase
      .from('venue_recaps')
      .insert({
        id: optimisticId,
        venue_id: venueId,
        username: uname,
        body: trimmed,
        stars,
        day_of: nightOf,
      })
      .select()
      .single();

    if (error) {
      // Handle unique constraint violation (duplicate recap)
      if (error.code === '23505') {
        console.warn('[recap] Duplicate — already posted tonight');
        return;
      }
      console.error('[recap] Insert error:', error.message);
      return;
    }

    if (data) {
      const row = data as VenueRecap;
      knownIds.current.add(row.id);
      setRecaps(prev => [row, ...prev]);
    }

    // PREDICTION ENGINE: log recap post as a signal
    if (venueId) {
      recordSignal({
        venueId,
        signalType: 'recap_post',
        sourceTable: 'venue_recaps',
        sourceRowId: optimisticId,
        metadata: { stars, body_length: trimmed.length },
      });
    }
  }, [venueId, nightOf]);

  return {
    recaps,
    submitRecap,
    avgRating,
    totalRecaps,
    tonightCount: recaps.length,
    hasUserRecapped,
  };
}
