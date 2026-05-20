import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, envReady } from '../lib/supabase';
import type { Venue } from '../lib/types';

export interface MapBounds {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

/**
 * Per-venue fused estimate row from the prediction engine.
 * Mirrors the columns the fusion fn writes into headcount_estimates.
 */
export interface HeadcountEstimate {
  estimate: number;
  estimate_low: number;
  estimate_high: number;
  confidence_pct: number;
  capacity_pct: number | null;
  state_label: string;       // 'Quiet'|'Lively'|'Busy'|'Packed'|'Surging'|'Unknown'
  trend: string | null;      // 'rising'|'falling'|'flat'
  trend_rate: number | null;
  computed_at: string;
  source_breakdown: Record<string, unknown> | null;
  delta_pct: number | null;
  expected_pct: number | null;
}

/** Venue plus the latest fused estimate (LEFT JOIN, may be empty array). */
export type VenueWithEstimate = Venue & {
  headcount_estimates: HeadcountEstimate[];
};

const VENUE_COLUMNS = 'id, created_at, name, slug, city, category, address, lat, lng, image_url, deals, hours, instagram, vibe_tagline, has_live_cam, live_cam_url, cam_coming_soon, is_active, sort_order, capacity, is_clicker_live, staff_code, phone, website, description, rating, review_count, tonight_special, special_updated_at, cover_charge, featured, featured_label, loyalty_active, nfc_tag_id, nfc_required, vibe_hue_baseline';
const ESTIMATE_COLUMNS = 'estimate, estimate_low, estimate_high, confidence_pct, capacity_pct, state_label, trend, trend_rate, computed_at, source_breakdown, delta_pct, expected_pct';
const LAUNCH_MARKETS = ['knoxville', 'tampa', 'st_petersburg'] as const;

/**
 * Global venue loader for launch markets — fetches every active
 * venue in knoxville/tampa/st_petersburg with the latest fused
 * estimate LEFT JOINed in, regardless of the current map bounds.
 *
 * The `bounds` parameter is intentionally accepted but unused. The
 * city dropdown only moves the map camera; the venue data set never
 * shrinks. When the user zooms out from Tampa over to St. Pete or
 * Knoxville, the bubbles are already in memory — no re-fetch latency
 * on city switches. The signature is preserved so a future bounds-
 * aware culling pass (relevant when venue counts cross the
 * thousand-per-market threshold) can return without an API change.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useVenuesInBounds(_bounds: MapBounds | null) {
  const [venues, setVenues] = useState<VenueWithEstimate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const firstFetchLoggedRef = useRef(false);
  const aliveRef = useRef(true);

  const fetchVenues = useCallback(async () => {
    if (!envReady) return;
    setError(false);

    const { data, error: err } = await supabase
      .from('venues')
      .select(`${VENUE_COLUMNS}, headcount_estimates(${ESTIMATE_COLUMNS})`)
      .in('city', LAUNCH_MARKETS as unknown as string[])
      .or('is_active.eq.true,is_active.is.null')
      .order('sort_order');

    if (!aliveRef.current) return;

    if (err) {
      console.error('[venuu] useVenuesInBounds fetch error:', err);
      setError(true);
      setLoading(false);
      return;
    }

    const rows = (data as VenueWithEstimate[]) ?? [];
    setVenues(rows);
    setLoading(false);

    if (!firstFetchLoggedRef.current) {
      firstFetchLoggedRef.current = true;
      const distinctCities = new Set(rows.map(v => v.city)).size;
      const withEst = rows.filter(v => (v.headcount_estimates?.length ?? 0) > 0).length;
      console.log(
        '[venuu] loaded ' + rows.length + ' venues across ' + distinctCities +
        ' cities (global mode); ' + withEst + ' with live estimates'
      );
    }
  }, []);

  // ── Initial fetch (one-shot for the lifetime of the hook) ─────
  useEffect(() => {
    aliveRef.current = true;
    setLoading(true);
    fetchVenues();
    return () => {
      aliveRef.current = false;
    };
  }, [fetchVenues]);

  // ── venues table updates (cover_charge, tonight_special, etc) ─
  useEffect(() => {
    if (!envReady) return;
    const channel = supabase
      .channel(`venues-rt-global-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'venues' },
        (payload) => {
          const updated = payload.new as Venue;
          setVenues(prev => {
            const idx = prev.findIndex(v => v.id === updated.id);
            if (idx === -1) return prev;
            const next = [...prev];
            // Preserve the nested headcount_estimates array when merging
            next[idx] = { ...next[idx], ...updated, headcount_estimates: next[idx].headcount_estimates };
            return next;
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── headcount_estimates updates — fusion fn writes once per minute ─
  useEffect(() => {
    if (!envReady) return;
    const channel = supabase
      .channel(`estimates-rt-global-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'headcount_estimates' },
        (payload) => {
          const row = (payload.new ?? payload.old) as { venue_id?: string } | null;
          const venueId = row?.venue_id;
          if (!venueId) return;

          setVenues(prev => {
            const idx = prev.findIndex(v => v.id === venueId);
            if (idx === -1) return prev;
            const next = [...prev];
            if (payload.eventType === 'DELETE') {
              next[idx] = { ...next[idx], headcount_estimates: [] };
            } else {
              const newRow = payload.new as Record<string, unknown>;
              const estimate: HeadcountEstimate = {
                estimate: Number(newRow.estimate ?? 0),
                estimate_low: Number(newRow.estimate_low ?? 0),
                estimate_high: Number(newRow.estimate_high ?? 0),
                confidence_pct: Number(newRow.confidence_pct ?? 0),
                capacity_pct: newRow.capacity_pct === null || newRow.capacity_pct === undefined
                  ? null
                  : Number(newRow.capacity_pct),
                state_label: String(newRow.state_label ?? 'Unknown'),
                trend: newRow.trend === null || newRow.trend === undefined
                  ? null
                  : String(newRow.trend),
                trend_rate: newRow.trend_rate === null || newRow.trend_rate === undefined
                  ? null
                  : Number(newRow.trend_rate),
                computed_at: String(newRow.computed_at ?? new Date().toISOString()),
                source_breakdown: (newRow.source_breakdown as Record<string, unknown> | null) ?? null,
                delta_pct: newRow.delta_pct === null || newRow.delta_pct === undefined
                  ? null
                  : Number(newRow.delta_pct),
                expected_pct: newRow.expected_pct === null || newRow.expected_pct === undefined
                  ? null
                  : Number(newRow.expected_pct),
              };
              next[idx] = { ...next[idx], headcount_estimates: [estimate] };
            }
            return next;
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Direct cover update from Portal — instant local merge ─────
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

  return {
    venues,
    loading,
    error,
    refetch: fetchVenues,
  };
}
