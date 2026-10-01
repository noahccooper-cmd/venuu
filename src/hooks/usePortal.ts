import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase, envReady } from '../lib/supabase';
import { getNightOf } from '../lib/utils';
import type { Venue, Headcount } from '../lib/types';

const COOLDOWN_MS = 150;
const PORTAL_VENUE_KEY = 'portal_venue_id';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export interface EndNightSummary {
  venueName: string;
  peakCount: number;
  peakTime: string;
}

export function usePortal() {
  const [venue, setVenue] = useState<Venue | null>(null);
  const [headcount, setHeadcount] = useState<Headcount | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastAction, setLastAction] = useState<{ type: string; time: string } | null>(null);
  const [endSummary, setEndSummary] = useState<EndNightSummary | null>(null);
  const cooldownRef = useRef(false);

  const savedVenueId = localStorage.getItem(PORTAL_VENUE_KEY) ?? '';

  // Real-time subscription for this venue's headcount
  useEffect(() => {
    if (!envReady || !venue) return;

    const channel = supabase
      .channel(`portal-hc-${venue.id}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'headcounts',
          filter: `venue_id=eq.${venue.id}`,
        },
        (payload) => {
          if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            const row = payload.new as Headcount;
            setHeadcount(row);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [venue?.id]);

  // Fetch venue + headcount by ID (for persistence restore)
  const loadVenueById = useCallback(async (venueId: string) => {
    if (!envReady) return;
    setLoading(true);
    setError('');

    const { data, error: err } = await supabase
      .from('venues')
      .select('*')
      .eq('id', venueId)
      .eq('is_active', true)
      .single();

    if (err || !data) {
      // Venue no longer active or deleted — clear persistence
      localStorage.removeItem(PORTAL_VENUE_KEY);
      setLoading(false);
      return;
    }

    setVenue(data as Venue);

    const nightOf = getNightOf();
    const { data: hc } = await supabase
      .from('headcounts')
      .select('*')
      .eq('venue_id', data.id)
      .eq('night_of', nightOf)
      .maybeSingle();

    if (hc) {
      setHeadcount(hc as Headcount);
    }
    setLoading(false);
  }, []);

  // PIN-based login: verify PIN server-side, never expose it
  const loginWithPin = useCallback(async (venueId: string, pin: string) => {
    if (!envReady) return { error: 'Not configured' };

    setLoading(true);
    setError('');
    setEndSummary(null);

    // Server-side PIN check — only returns data if PIN matches
    const { data, error: err } = await supabase
      .from('venues')
      .select('id, name, slug, city, category, address, lat, lng, image_url, deals, hours, instagram, vibe_tagline, has_live_cam, live_cam_url, cam_coming_soon, is_active, sort_order, capacity, is_clicker_live, staff_code, phone, website, description, rating, review_count, tonight_special, special_updated_at, cover_charge, featured, featured_label, loyalty_active, nfc_tag_id, nfc_required, created_at')
      .eq('id', venueId)
      .eq('staff_code', pin)
      .eq('is_active', true)
      .single();

    setLoading(false);

    if (err || !data) {
      setError('Wrong code');
      return { error: 'Wrong code' };
    }

    const venueData = data as Venue;
    setVenue(venueData);
    localStorage.setItem(PORTAL_VENUE_KEY, venueData.id);

    // Fetch tonight's headcount
    const nightOf = getNightOf();
    const { data: hc } = await supabase
      .from('headcounts')
      .select('*')
      .eq('venue_id', venueData.id)
      .eq('night_of', nightOf)
      .maybeSingle();

    if (hc) {
      setHeadcount(hc as Headcount);
    }

    return { error: null };
  }, []);

  const handleEnter = useCallback(async (count = 1) => {
    if (!venue || cooldownRef.current) return;
    cooldownRef.current = true;
    setTimeout(() => { cooldownRef.current = false; }, COOLDOWN_MS);

    const nightOf = getNightOf();

    // Optimistic update
    setHeadcount(prev => {
      const newCount = Math.max((prev?.current_count ?? 0) + count, 0);
      return {
        ...(prev ?? {
          id: '',
          created_at: new Date().toISOString(),
          venue_id: venue.id,
          city: venue.city,
          night_of: nightOf,
          last_updated_by: null,
          is_live: true,
          peak_count: 0,
        }),
        updated_at: new Date().toISOString(),
        current_count: newCount,
        peak_count: Math.max(prev?.peak_count ?? 0, newCount),
      } as Headcount;
    });

    setLastAction({ type: `+${count}`, time: new Date().toISOString() });

    const { data } = await supabase.rpc(count === 1 ? 'increment_headcount' : 'adjust_headcount', {
      target_venue: venue.id,
      target_city: venue.city,
      target_night: nightOf,
      staff_user: null,
      ...(count !== 1 ? { adjustment: count } : {}),
    });

    if (data) {
      const result = data as { new_count: number; peak?: number };
      setHeadcount(prev => prev ? {
        ...prev,
        current_count: result.new_count,
        peak_count: result.peak ?? prev.peak_count,
      } : null);

      // Push headcount update directly into useHeadcounts state (same pattern as cover charge)
      window.dispatchEvent(new CustomEvent('headcount-update', {
        detail: { venueId: venue.id, currentCount: result.new_count, isLive: true },
      }));

      supabase.from('clicker_logs').insert({
        venue_id: venue.id,
        staff_id: null,
        action: 'enter',
        night_of: nightOf,
        count_after: result.new_count,
      });
    }
  }, [venue]);

  const handleExit = useCallback(async (count = 1) => {
    if (!venue || cooldownRef.current) return;
    cooldownRef.current = true;
    setTimeout(() => { cooldownRef.current = false; }, COOLDOWN_MS);

    const nightOf = getNightOf();

    setHeadcount(prev => prev ? {
      ...prev,
      updated_at: new Date().toISOString(),
      current_count: Math.max(prev.current_count - count, 0),
    } : null);

    setLastAction({ type: `-${count}`, time: new Date().toISOString() });

    const { data } = await supabase.rpc(count === 1 ? 'decrement_headcount' : 'adjust_headcount', {
      target_venue: venue.id,
      target_city: venue.city,
      target_night: nightOf,
      staff_user: null,
      ...(count !== 1 ? { adjustment: -count } : {}),
    });

    if (data) {
      const result = data as { new_count: number };
      setHeadcount(prev => prev ? {
        ...prev,
        current_count: result.new_count,
      } : null);

      // Push headcount update directly into useHeadcounts state (same pattern as cover charge)
      window.dispatchEvent(new CustomEvent('headcount-update', {
        detail: { venueId: venue.id, currentCount: result.new_count, isLive: true },
      }));

      supabase.from('clicker_logs').insert({
        venue_id: venue.id,
        staff_id: null,
        action: 'exit',
        night_of: nightOf,
        count_after: result.new_count,
      });
    }
  }, [venue]);

  const updateCover = useCallback(async (text: string) => {
    if (!venue || !envReady) return;
    const coverText = text.trim() || null;
    const { error } = await supabase
      .from('venues')
      .update({ cover_charge: coverText })
      .eq('id', venue.id);

    setVenue(prev => prev ? { ...prev, cover_charge: coverText } : null);

    // Push cover update directly into useVenues state (same pattern as headcount realtime)
    // This is immediate — no async refetch, no race condition
    if (!error) {
      window.dispatchEvent(new CustomEvent('venues-cover-update', {
        detail: { venueId: venue.id, cover_charge: coverText },
      }));
    }
  }, [venue]);

  const endNight = useCallback(async () => {
    if (!venue) return;
    if (!venue.staff_code) {
      console.error('[portal] end-night: missing staff_code');
      return;
    }
    const nightOf = getNightOf();

    let peakCount = headcount?.peak_count ?? 0;
    let peakTime = headcount?.updated_at ?? new Date().toISOString();

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/end-night`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({
          venue_id: venue.id,
          portal_pin: venue.staff_code,
          night_of: nightOf,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        console.error('[portal] end-night error:', res.status, data);
        return;
      }
      peakCount = data.peak_count ?? peakCount;
      peakTime = data.peak_time ?? peakTime;
    } catch (err) {
      console.error('[portal] end-night FAILED:', err);
      return;
    }

    const summary: EndNightSummary = {
      venueName: venue.name,
      peakCount,
      peakTime,
    };

    // Dispatch updates so map immediately reflects end-of-night
    window.dispatchEvent(new CustomEvent('venues-cover-update', {
      detail: { venueId: venue.id, cover_charge: null },
    }));
    window.dispatchEvent(new CustomEvent('headcount-update', {
      detail: { venueId: venue.id, currentCount: 0, isLive: false },
    }));

    // Clear persistence — End Night returns to login
    localStorage.removeItem(PORTAL_VENUE_KEY);

    // Update local state and show summary
    setHeadcount(prev => prev ? { ...prev, current_count: 0, is_live: false } : null);
    setVenue(prev => prev ? { ...prev, cover_charge: null, tonight_special: null, special_updated_at: null, is_clicker_live: false } : null);
    setEndSummary(summary);
  }, [venue, headcount]);

  const disconnect = useCallback(() => {
    localStorage.removeItem(PORTAL_VENUE_KEY);
    setVenue(null);
    setHeadcount(null);
    setLastAction(null);
    setError('');
    setEndSummary(null);
  }, []);

  return {
    venue,
    headcount,
    loading,
    error,
    lastAction,
    savedVenueId,
    endSummary,
    loginWithPin,
    loadVenueById,
    handleEnter,
    handleExit,
    updateCover,
    endNight,
    disconnect,
  };
}
