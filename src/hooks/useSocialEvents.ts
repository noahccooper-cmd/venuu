import { useEffect, useRef, useState } from 'react';
import type { CityKey } from '../lib/constants';
import type { SocialCategory, SocialEvent } from '../lib/socialTypes';
import { buildSocialFixtures } from '../lib/socialFixtures';
import { loadDemoEvents, subscribeDemoEvents } from '../lib/socialDemoStore';
import { supabase } from '../lib/supabase';
import { SOCIAL_DEMO } from '../lib/socialMode';
import { SOCIAL_CITIES } from '../lib/socialGeo';
import { applyDemoOverrides } from '../lib/socialModeration';

export interface SocialEventsResult {
  /** Visible events (active, not denied, not from blocked posters), soonest first. */
  events: SocialEvent[];
  /** My own events an admin denied that I haven't acknowledged yet. */
  deniedMine: SocialEvent[];
  loading: boolean;
  error: string | null;
}

const COLUMNS = 'id, city, surface, category, title, host_name, host_profile_id, external_venue_name, address, latitude, longitude, '
  + 'start_time, end_time, expires_at, series_id, description, date_tba, image_url, verification, created_at, going_count, '
  + 'is_active, denial_seen_at, brands(slug)';

type Row = {
  id: string; city: string; category: string | null; title: string; host_name: string;
  host_profile_id: string | null; external_venue_name: string | null; address: string | null; latitude: number; longitude: number;
  start_time: string; end_time: string | null; expires_at: string; series_id: string | null; description: string | null;
  date_tba: boolean | null; image_url: string | null; verification: string | null; created_at: string | null;
  going_count: number | null; is_active: boolean | null; denial_seen_at: string | null;
  brands: { slug: string } | { slug: string }[] | null;
};

const CATS: SocialCategory[] = ['run_club', 'pop_up', 'nightlife', 'other'];

function toEvent(r: Row): SocialEvent | null {
  if (!SOCIAL_CITIES.includes(r.city as CityKey)) return null;
  const brand = Array.isArray(r.brands) ? r.brands[0]?.slug : r.brands?.slug;
  return {
    id: r.id, city: r.city as CityKey, surface: 'social',
    category: CATS.includes(r.category as SocialCategory) ? (r.category as SocialCategory) : 'other',
    brand: brand ?? null, title: r.title, host_name: r.host_name, host_profile_id: r.host_profile_id,
    external_venue_name: r.external_venue_name, address: r.address ?? '', latitude: r.latitude, longitude: r.longitude,
    start_time: r.start_time, end_time: r.end_time, expires_at: r.expires_at, series_id: r.series_id,
    description: r.description, date_tba: !!r.date_tba, photo_url: r.image_url,
    verification: r.verification === 'community' ? 'community' : r.verification === 'denied' ? 'denied' : 'verified',
    created_at: r.created_at ?? undefined, going_count: r.going_count ?? 0, is_active: r.is_active !== false,
    denial_seen_at: r.denial_seen_at,
  };
}

const byStart = (a: SocialEvent, b: SocialEvent) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime();

async function fetchSocialEvents(): Promise<{ rows: SocialEvent[] | null; error: string | null }> {
  const now = Date.now();
  if (SOCIAL_DEMO) {
    return { rows: applyDemoOverrides([...buildSocialFixtures(new Date(now)), ...loadDemoEvents()]).filter(e => new Date(e.expires_at).getTime() > now).sort(byStart), error: null };
  }
  if (!supabase) return { rows: null, error: 'offline' };
  const { data, error } = await supabase.from('events').select(COLUMNS)
    .eq('surface', 'social').gt('expires_at', new Date(now).toISOString())
    .order('start_time', { ascending: true }).limit(500);
  if (error) return { rows: null, error: error.message };
  return { rows: ((data ?? []) as unknown as Row[]).map(toEvent).filter((e): e is SocialEvent => !!e), error: null };
}

/**
 * Every Social event across the three cities, in one read.
 *
 * Live: public.events (surface='social'). RLS already hides inactive and
 * denied rows from everyone but their owner and admins; realtime changes
 * trigger a debounced refetch. Demo: local fixtures + demo posts.
 * `refreshKey` bumps a refetch (pull-to-refresh, after posting).
 */
export function useSocialEvents(refreshKey = 0, profileId: string | null = null, blocked?: Set<string>): SocialEventsResult {
  const [all, setAll] = useState<SocialEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const debounce = useRef(0);

  useEffect(() => {
    let live = true;
    void fetchSocialEvents().then(r => {
      if (!live) return;
      if (r.rows) { setAll(r.rows); setError(null); } else setError(r.error);
      setLoading(false);
    });
    return () => { live = false; };
  }, [refreshKey, tick]);

  // Demo posts / live changes → refetch.
  useEffect(() => {
    if (SOCIAL_DEMO) return subscribeDemoEvents(() => setTick(t => t + 1));
    if (!supabase) return;
    const ch = supabase
      .channel('social-events')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: 'surface=eq.social' }, () => {
        window.clearTimeout(debounce.current);
        debounce.current = window.setTimeout(() => setTick(t => t + 1), 500);
      })
      .subscribe();
    return () => { window.clearTimeout(debounce.current); void supabase.removeChannel(ch); };
  }, []);

  const events = all.filter(e => e.is_active !== false && e.verification !== 'denied'
    && !(e.host_profile_id && blocked?.has(e.host_profile_id)));
  const deniedMine = profileId
    ? all.filter(e => e.verification === 'denied' && e.host_profile_id === profileId && !e.denial_seen_at)
    : [];
  return { events, deniedMine, loading, error };
}
