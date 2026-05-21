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

export interface VibeCanvasPoint {
  venue_id: string;
  lat: number;
  lng: number;
  hue_degrees: number;     // 0-360, HSL hue angle
  saturation_pct: number;  // 70-100, Phase B.5 floor enforced server-side
  intensity: number;       // currently always 1.0; will modulate in Phase E
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

  // Realtime: subscribe to vibe_ratings INSERTs
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
    return () => {
      supabase.removeChannel(channel);
      if (pendingRefreshRef.current) {
        clearTimeout(pendingRefreshRef.current);
        pendingRefreshRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]);

  return { points, loading, error };
}
