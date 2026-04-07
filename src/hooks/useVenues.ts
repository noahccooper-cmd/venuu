import { useState, useEffect, useCallback } from 'react';
import { supabase, envReady } from '../lib/supabase';
import type { Venue } from '../lib/types';
import { CITIES, type CityKey } from '../lib/constants';

export function useVenues(city: CityKey) {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchVenues = useCallback(async () => {
    if (!envReady) return;
    setError(false);
    const { data, error: err } = await supabase
      .from('venues')
      .select('id, created_at, name, slug, city, category, address, lat, lng, image_url, cover_price, deals, hours, instagram, vibe, has_live_cam, live_cam_url, cam_coming_soon, is_active, sort_order, capacity, is_clicker_live, staff_code, phone, website, description, rating, review_count, tonight_special, special_updated_at, special, cover_charge, featured, featured_label, loyalty_active, nfc_tag_id, nfc_required')
      .ilike('city', `%${city}%`)
      .or('is_active.eq.true,is_active.is.null')
      .order('sort_order');

    if (err) {
      console.error('[venuu] useVenues fetch error:', err);
      setError(true);
      setLoading(false);
      return;
    }
    const rows = (data as Venue[]) ?? [];
    setVenues(rows);
    setLoading(false);
  }, [city]);

  // Initial fetch
  useEffect(() => {
    if (!envReady) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchVenues();
  }, [fetchVenues]);

  // Real-time subscription for venue updates (cover_charge, tonight_special, is_clicker_live)
  useEffect(() => {
    if (!envReady) return;

    const channel = supabase
      .channel(`venues-rt-${city}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'venues',
        },
        (payload) => {
          const updated = payload.new as Venue;
          if (updated.city !== CITIES[city].dbCity) return;
          setVenues(prev =>
            prev.map(v => v.id === updated.id ? { ...v, ...updated } : v)
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [city]);

  // Direct cover update from Portal — applies immediately into venues state
  useEffect(() => {
    const handler = (e: Event) => {
      const { venueId, cover_charge } = (e as CustomEvent).detail;
      setVenues(prev =>
        prev.map(v => v.id === venueId ? { ...v, cover_charge } : v)
      );
    };
    window.addEventListener('venues-cover-update', handler);
    return () => window.removeEventListener('venues-cover-update', handler);
  }, []);

  return { venues, loading, error, refetch: fetchVenues };
}
