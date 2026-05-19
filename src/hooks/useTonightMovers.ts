import { useEffect, useState } from 'react';
import { supabase, envReady } from '../lib/supabase';

/**
 * One row from the `tonight_movers` SQL view (migration 00050).
 * Identical column set to `headcount_estimates` joined to `venues`,
 * plus a derived `movement_tier` and per-city RANK windows so the
 * UI can label "Tonight's Top Riser" without a second query.
 */
export interface TonightMover {
  venue_id: string;
  venue_name: string;
  venue_slug: string;
  city: string;
  lat: number;
  lng: number;
  image_url: string | null;
  delta_pct: number;
  estimate: number;
  state_label: string;
  confidence_pct: number;
  trend: string | null;
  trend_rate: number | null;
  movement_tier: 'top_riser' | 'rising' | 'flat' | 'falling' | 'top_faller';
  rank_in_city_desc: number;
  rank_in_city_asc: number;
}

/**
 * Pulls the `limit` strongest risers + fallers in a city, sorted by
 * delta_pct descending and ascending respectively. Refreshes every
 * 60 s; the same view backs both queries so the two stay consistent.
 */
export function useTonightMovers(city: string | null, limit: number = 5) {
  const [risers, setRisers] = useState<TonightMover[]>([]);
  const [fallers, setFallers] = useState<TonightMover[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!city || !envReady) {
      setRisers([]);
      setFallers([]);
      return;
    }

    let cancelled = false;
    const fetchMovers = async () => {
      setLoading(true);

      const [risersRes, fallersRes] = await Promise.all([
        supabase
          .from('tonight_movers')
          .select('*')
          .eq('city', city)
          .order('delta_pct', { ascending: false })
          .limit(limit),
        supabase
          .from('tonight_movers')
          .select('*')
          .eq('city', city)
          .order('delta_pct', { ascending: true })
          .limit(limit),
      ]);

      if (cancelled) return;
      setRisers((risersRes.data ?? []) as TonightMover[]);
      setFallers((fallersRes.data ?? []) as TonightMover[]);
      setLoading(false);
    };

    fetchMovers();
    const interval = window.setInterval(fetchMovers, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [city, limit]);

  return { risers, fallers, loading };
}
