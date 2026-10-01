import { useState, useEffect, useCallback } from 'react';
import { supabase, envReady } from '../lib/supabase';
import type { VenueEvent } from '../lib/types';
import type { CityKey } from '../lib/constants';
import { toCityKey, isSameCity } from '../lib/cityKey';

export function useEvents(city: CityKey) {
  const [events, setEvents] = useState<VenueEvent[]>([]);

  const fetchEvents = useCallback(async () => {
    if (!envReady) return;
    const cityKey = toCityKey(city);
    if (!cityKey) { setEvents([]); return; }
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('city', cityKey)
      // Social posts live on the Social tab only — never on Tonight.
      .eq('surface', 'tonight')
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .order('start_time');

    if (error) {
      console.error('[events] Fetch error:', error.message);
      return;
    }
    setEvents((data as VenueEvent[]) ?? []);
  }, [city]);

  // Initial fetch
  useEffect(() => {
    if (!envReady) return;
    fetchEvents();
  }, [fetchEvents]);

  // Realtime subscription
  useEffect(() => {
    if (!envReady) return;

    const channel = supabase
      .channel(`events-rt-${city}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events' },
        (payload) => {
          const row = payload.new as VenueEvent;
          if (row.surface !== 'social' && isSameCity(row.city, city) && row.is_active && new Date(row.expires_at) > new Date()) {
            setEvents(prev => [row, ...prev]);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events' },
        (payload) => {
          const row = payload.new as VenueEvent;
          const matches = row.surface !== 'social' && isSameCity(row.city, city) && row.is_active && new Date(row.expires_at) > new Date();
          setEvents(prev => {
            const exists = prev.some(e => e.id === row.id);
            if (matches && exists) return prev.map(e => e.id === row.id ? row : e);
            if (matches && !exists) return [row, ...prev];
            if (!matches && exists) return prev.filter(e => e.id !== row.id);
            return prev;
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'events' },
        (payload) => {
          const old = payload.old as { id: string };
          setEvents(prev => prev.filter(e => e.id !== old.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [city]);

  return { events };
}
