// src/hooks/useVibeCanvasPoints.ts
//
// Phase D.5 — live data source for the street-zoom WebGL canvas.
// Queries public.get_vibe_canvas_points(city), subscribes to vibe_ratings
// INSERTs, re-queries on paint events with a 2s throttle.
//
// Each row exposed to the shader carries position + hue + saturation +
// intensity. The shader uses these as Gaussian field sources blended
// pixel-by-pixel via circular-mean.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Row returned by get_vibe_canvas_points RPC (migration 00061).
 *
 * hue_degrees:    CONTINUOUS numeric degrees [0, 360). Soul-true unsnapped
 *                 circular mean of canonical + recency-decayed paints.
 * saturation_pct: Earned-vibe curve 55-95. Canonical = 55 (soft presence),
 *                 +4 per paint up to 10 paints = 95 (vivid earned identity).
 * intensity:      Always 1.0 currently (Phase B.5: canvas alive 24/7).
 * paint_count:    Total paints all-time. Drives saturation; visual lever.
 */
export interface VibeCanvasPoint {
  venue_id: string;
  lat: number;
  lng: number;
  hue_degrees: number;     // numeric, continuous
  saturation_pct: number;  // 55-95, earned-vibe
  intensity: number;       // 1.0 currently
  state_label: string;
  paint_count: number;
}

interface UseVibeCanvasPointsResult {
  points: VibeCanvasPoint[];
  loading: boolean;
  error: string | null;
}

const REFRESH_THROTTLE_MS = 2000;

export function useVibeCanvasPoints(city: string | null | undefined): UseVibeCanvasPointsResult {
  const [points, setPoints] = useState<VibeCanvasPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastFetchAtRef = useRef<number>(0);
  const pendingRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPoints = async () => {
    if (!city) {
      setPoints([]);
      setLoading(false);
      return;
    }
    lastFetchAtRef.current = Date.now();
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_vibe_canvas_points', { p_city: city });
      if (rpcErr) {
        console.error('[useVibeCanvasPoints] rpc error', rpcErr);
        setError(rpcErr.message);
        setLoading(false);
        return;
      }
      const normalized: VibeCanvasPoint[] = (data ?? []).map((r: any) => ({
        venue_id: r.venue_id,
        lat: Number(r.lat),
        lng: Number(r.lng),
        hue_degrees: Number(r.hue_degrees),
        saturation_pct: Number(r.saturation_pct),
        intensity: Number(r.intensity),
        state_label: r.state_label ?? 'Unknown',
        paint_count: Number(r.paint_count ?? 0),
      }));
      setPoints(normalized);
      setError(null);
      setLoading(false);
    } catch (err: any) {
      console.error('[useVibeCanvasPoints] fetch error', err);
      setError(err?.message ?? 'unknown error');
      setLoading(false);
    }
  };

  const throttledRefresh = () => {
    const elapsed = Date.now() - lastFetchAtRef.current;
    if (elapsed >= REFRESH_THROTTLE_MS) {
      fetchPoints();
    } else if (!pendingRefreshRef.current) {
      const wait = REFRESH_THROTTLE_MS - elapsed;
      pendingRefreshRef.current = setTimeout(() => {
        pendingRefreshRef.current = null;
        fetchPoints();
      }, wait);
    }
  };

  // Initial + city-change fetch
  useEffect(() => {
    setLoading(true);
    fetchPoints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]);

  // Realtime: subscribe to vibe_ratings INSERTs (instant on paint)
  // + continuous poll every 60s (so recency decay animates smoothly
  //   as paints age, even when nobody is painting right now)
  useEffect(() => {
    if (!city) return;
    const channel = supabase
      .channel(`vibe-canvas-${city}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'vibe_ratings' },
        () => {
          throttledRefresh();
        }
      )
      .subscribe();

    // Continuous evolution poll: canvas re-queries every 60s so the
    // recency-decayed current_hue per venue animates smoothly through
    // the night without requiring fresh paint events.
    const pollInterval = setInterval(() => {
      throttledRefresh();
    }, 60_000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
      if (pendingRefreshRef.current) {
        clearTimeout(pendingRefreshRef.current);
        pendingRefreshRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]);

  return { points, loading, error };
}
