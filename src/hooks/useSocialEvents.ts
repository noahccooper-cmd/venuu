import { useEffect, useState } from 'react';
import type { CityKey } from '../lib/constants';
import type { SocialEvent } from '../lib/socialTypes';
import { buildSocialFixtures } from '../lib/socialFixtures';

export interface SocialEventsResult {
  events: SocialEvent[];
  loading: boolean;
  error: string | null;
}

/**
 * Social events for one city, soonest first, expired excluded.
 *
 * DEMO: reads local fixtures. The swap to Supabase is this one body —
 * same return shape, same filtering:
 *
 *   const { data, error } = await supabase
 *     .from('events')
 *     .select('*, brand:brands(slug)')        // → flatten brand to slug
 *     .eq('surface', 'social')
 *     .eq('city', city)
 *     .eq('is_active', true)
 *     .gt('expires_at', new Date().toISOString())
 *     .order('start_time', { ascending: true });
 */
export function useSocialEvents(city: CityKey | null): SocialEventsResult {
  const [result, setResult] = useState<SocialEventsResult>({ events: [], loading: true, error: null });

  useEffect(() => {
    if (!city) {
      setResult({ events: [], loading: false, error: null });
      return;
    }
    const now = Date.now();
    const events = buildSocialFixtures(new Date(now))
      .filter(e => e.city === city && new Date(e.expires_at).getTime() > now)
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    setResult({ events, loading: false, error: null });
  }, [city]);

  return result;
}
