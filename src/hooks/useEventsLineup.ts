import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { VenueEvent } from '../lib/types';

/**
 * Curated events lineup for events mode. Fetches all events where
 * curated=true for the current city, partitions them into three
 * temporal sections, and refetches when going_count changes (so
 * RSVP optimistic updates stay in sync).
 *
 * Sections:
 *   - now_playing: events in next 72 hours
 *   - this_week:   events in next 14 days
 *   - on_horizon:  curated events 14+ days out (marquee no longer
 *                  gates visibility — curation is the filter)
 */

export type LineupSection = 'now_playing' | 'this_week' | 'on_horizon';

export interface LineupEvent extends VenueEvent {
  curated: boolean;
  marquee: boolean;
  going_count: number;
  section: LineupSection;
}

export const SECTION_LABELS: Record<LineupSection, string> = {
  now_playing: 'ON TONIGHT',
  this_week: 'THIS WEEK',
  on_horizon: 'ON THE HORIZON',
};

function partitionEvent(evt: VenueEvent & { marquee: boolean }, now: Date): LineupSection | null {
  const start = new Date(evt.start_time);
  const hoursUntil = (start.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursUntil < 0) {
    // Past event (still within expires_at window): treat as now_playing
    return 'now_playing';
  }
  if (hoursUntil <= 72) return 'now_playing';       // next 3 days = right now energy
  if (hoursUntil <= 336) return 'this_week';        // next 14 days = this week
  return 'on_horizon';                              // 14+ days out = horizon
  // NOTE: marquee flag no longer gates visibility — curation is the
  // filter. Marquee drives visual prominence on map + ★ in cards.
}

export function useEventsLineup(city: string | null) {
  const [allCurated, setAllCurated] = useState<LineupEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());

  // Refresh "now" every minute so partitioning stays current
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Fetch curated events for the city
  useEffect(() => {
    if (!city) {
      setAllCurated([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('city', city)
        .eq('curated', true)
        .eq('is_active', true)
        .order('start_time', { ascending: true });

      if (cancelled) return;
      if (error) {
        console.error('[useEventsLineup] fetch error', error.message);
        setAllCurated([]);
      } else {
        const events = (data as (VenueEvent & { curated: boolean; marquee: boolean; going_count: number })[]) ?? [];
        const tagged: LineupEvent[] = events
          .map(e => {
            const section = partitionEvent(e, now);
            if (section === null) return null;
            return { ...e, section };
          })
          .filter((e): e is LineupEvent => e !== null);
        setAllCurated(tagged);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [city, now]);

  // Realtime subscription to going_count changes (so RSVP optimistic
  // updates from other users surface here)
  useEffect(() => {
    if (!city) return;
    const channel = supabase
      .channel(`events-lineup-${city}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events' },
        (payload) => {
          const updated = payload.new as VenueEvent & { going_count: number };
          if (!updated.id) return;
          setAllCurated(prev =>
            prev.map(e => e.id === updated.id ? { ...e, going_count: updated.going_count } : e)
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [city]);

  const bySection = useMemo(() => ({
    now_playing: allCurated.filter(e => e.section === 'now_playing'),
    this_week:   allCurated.filter(e => e.section === 'this_week'),
    on_horizon:  allCurated.filter(e => e.section === 'on_horizon'),
  }), [allCurated]);

  return { allCurated, bySection, loading };
}
