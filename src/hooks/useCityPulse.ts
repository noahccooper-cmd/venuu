import { useEffect, useState } from 'react';
import { supabase, envReady } from '../lib/supabase';

/**
 * One row from the `city_pulse` SQL view (migration 00049). All venues
 * with confidence_pct >= 35 and a non-null delta_pct in the last 5 min
 * are aggregated into a single rollup per city.
 */
export interface CityPulse {
  city: string;
  venues_with_signal: number;
  avg_delta_pct: number;
  top_riser_delta: number;
  top_faller_delta: number;
  surging_count: number;
  busy_count: number;
  quiet_count: number;
  computed_at: string;
}

/**
 * Polls `city_pulse` once on mount and every 60 s thereafter (matches
 * the fusion cron cadence). Returns null while loading or when the
 * city has no confident venues right now.
 */
export function useCityPulse(city: string | null) {
  const [pulse, setPulse] = useState<CityPulse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!city || !envReady) {
      setPulse(null);
      return;
    }

    let cancelled = false;
    const fetchPulse = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('city_pulse')
        .select('*')
        .eq('city', city)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.warn('[city_pulse] fetch failed', error.message);
        setPulse(null);
      } else {
        setPulse(data as CityPulse | null);
      }
      setLoading(false);
    };

    fetchPulse();
    const interval = window.setInterval(fetchPulse, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [city]);

  return { pulse, loading };
}
