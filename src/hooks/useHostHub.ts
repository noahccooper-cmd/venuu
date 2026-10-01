import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Venue, VenueEvent } from '../lib/types';

export interface HostHubData {
  hub: Venue;
  events: VenueEvent[];     // curated events at this hub (chronological)
  tenants: Venue[];         // venues that have tenant_of = this hub
  loading: boolean;
}

/**
 * Fetches a host hub + its curated events + its tenant venues.
 * Used by HostHubCard to render the full hub view when a user
 * taps a hub pin in events mode.
 *
 * Realtime: subscribes to events.going_count updates so the
 * card stays in sync with RSVPs.
 */
export function useHostHub(hubId: string | null): HostHubData | null {
  const [data, setData] = useState<HostHubData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hubId) { setData(null); return; }

    let cancelled = false;
    setLoading(true);

    (async () => {
      // Parallel fetch: hub, its curated events, its tenants
      const [hubRes, eventsRes, tenantsRes] = await Promise.all([
        supabase.from('venues').select('*').eq('id', hubId).single(),
        supabase.from('events')
          .select('*')
          .eq('venue_id', hubId)
          .eq('curated', true)
          .eq('is_active', true)
          .order('start_time', { ascending: true }),
        supabase.from('venues')
          .select('*')
          .eq('tenant_of', hubId)
          .eq('is_active', true)
          .order('name', { ascending: true }),
      ]);

      if (cancelled) return;

      if (hubRes.error || !hubRes.data) {
        console.error('[useHostHub] hub fetch error', hubRes.error?.message);
        setData(null);
        setLoading(false);
        return;
      }

      const now = new Date();
      const futureEvents = (eventsRes.data ?? []).filter(e => {
        const expires = e.expires_at ? new Date(e.expires_at) : null;
        if (expires && expires < now) return false;
        return true;
      });

      setData({
        hub: hubRes.data as Venue,
        events: futureEvents as VenueEvent[],
        tenants: (tenantsRes.data ?? []) as Venue[],
        loading: false,
      });
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [hubId]);

  // Realtime subscription to going_count updates for events at this hub
  useEffect(() => {
    if (!hubId) return;
    const channel = supabase
      .channel(`hub-${hubId}-${Date.now()}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events' },
        (payload) => {
          const updated = payload.new as VenueEvent & { going_count: number };
          if (!updated.id) return;
          setData(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              events: prev.events.map(e =>
                e.id === updated.id ? { ...e, going_count: updated.going_count } : e
              ),
            };
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [hubId]);

  return data ? { ...data, loading } : null;
}
