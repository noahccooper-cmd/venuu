import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, envReady } from '../lib/supabase';
import type { Venue } from '../lib/types';
import { normalizeEstimates, sameEstimate, toEstimate } from '../lib/estimates';
import {
  fetchVenuesWithEstimates,
  readVenuesCache,
  releasePrefetch,
  takePrefetch,
  writeVenuesCache,
} from '../lib/venuesLoader';
import { debugLog } from '../lib/debug';

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
  /** True while this row came from the on-device cache and the network
   *  refresh hasn't landed yet — drives the subtle "updating" state. */
  cached?: boolean;
};

const CACHE_WRITE_THROTTLE_MS = 10_000;

/**
 * Global venue loader for launch markets — fetches every active
 * venue in knoxville/tampa/st_petersburg with the latest fused
 * estimate LEFT JOINed in, regardless of the current map bounds.
 *
 * Load order (stale-while-revalidate):
 *   1. Initial state comes from the on-device cache, so the map paints
 *      dots AND numbers on the first frame of a warm open.
 *   2. The network query (already started in main.tsx before React
 *      mounted) replaces it in one state update.
 *   3. Realtime estimate/venue changes are buffered and applied once
 *      per animation frame — the fusion cron upserts ~80 rows per tick,
 *      which used to mean ~80 full-map re-renders.
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
  const [initialCache] = useState(() => readVenuesCache());
  const [venues, setVenues] = useState<VenueWithEstimate[]>(
    () => initialCache?.map(v => ({ ...v, cached: true })) ?? [],
  );
  const [loading, setLoading] = useState(!initialCache);
  const [error, setError] = useState(false);
  const firstFetchLoggedRef = useRef(false);
  const aliveRef = useRef(true);
  const venuesRef = useRef(venues);
  useEffect(() => { venuesRef.current = venues; }, [venues]);

  // ── Cache writes (throttled; realtime ticks arrive every minute) ─
  const cacheTimerRef = useRef<number | null>(null);
  const lastCacheWriteRef = useRef(0);
  const scheduleCacheWrite = useCallback(() => {
    if (cacheTimerRef.current !== null) return;
    const wait = Math.max(0, CACHE_WRITE_THROTTLE_MS - (Date.now() - lastCacheWriteRef.current));
    cacheTimerRef.current = window.setTimeout(() => {
      cacheTimerRef.current = null;
      lastCacheWriteRef.current = Date.now();
      // Never persist rows still flagged as cached (no fresh data yet).
      const fresh = venuesRef.current.filter(v => !v.cached);
      if (fresh.length > 0) writeVenuesCache(fresh);
    }, wait);
  }, []);

  const applyFetched = useCallback((rows: VenueWithEstimate[]) => {
    // Keep object identity for venues whose data didn't change so memoised
    // bubbles don't re-render (and nothing visibly moves).
    setVenues(prev => {
      const prevById = new Map(prev.map(v => [v.id, v]));
      return rows.map(row => {
        const old = prevById.get(row.id);
        if (!old) return row;
        const est = sameEstimate(old.headcount_estimates[0], row.headcount_estimates[0])
          ? old.headcount_estimates
          : row.headcount_estimates;
        return { ...row, headcount_estimates: est };
      });
    });
    lastCacheWriteRef.current = Date.now();
    writeVenuesCache(rows);

    if (!firstFetchLoggedRef.current) {
      firstFetchLoggedRef.current = true;
      const distinctCities = new Set(rows.map(v => v.city)).size;
      const withEst = rows.filter(v => v.headcount_estimates.length > 0).length;
      debugLog(
        '[venuu] loaded ' + rows.length + ' venues across ' + distinctCities +
        ' cities (global mode); ' + withEst + ' with live estimates'
      );
    }
  }, []);

  const fetchVenues = useCallback(async (opts?: { usePrefetch?: boolean }) => {
    if (!envReady) return;
    setError(false);

    const pending = opts?.usePrefetch ? takePrefetch() : null;
    const { data, error: err } = await (pending ?? fetchVenuesWithEstimates());

    if (!aliveRef.current) return;
    if (pending) releasePrefetch();

    if (err || !data) {
      console.error('[venuu] useVenuesInBounds fetch error:', err);
      // With cached venues on screen, keep showing them rather than the
      // connection-error screen.
      if (venuesRef.current.length === 0) setError(true);
      setLoading(false);
      return;
    }

    applyFetched(data);
    setLoading(false);
  }, [applyFetched]);

  // ── Initial fetch (one-shot for the lifetime of the hook) ─────
  useEffect(() => {
    aliveRef.current = true;
    fetchVenues({ usePrefetch: true });
    return () => {
      aliveRef.current = false;
    };
  }, [fetchVenues]);

  // ── Refresh when the app returns to the foreground ────────────
  // Realtime can drop while backgrounded on iOS; one query catches up.
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) fetchVenues(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchVenues]);

  // ── Realtime batching: buffer, then apply once per frame ──────
  const pendingEstimatesRef = useRef(new Map<string, HeadcountEstimate[]>());
  const pendingVenueUpdatesRef = useRef(new Map<string, Partial<Venue>>());
  const flushRafRef = useRef<number | null>(null);

  const flushPending = useCallback(() => {
    flushRafRef.current = null;
    const estimates = pendingEstimatesRef.current;
    const updates = pendingVenueUpdatesRef.current;
    if (estimates.size === 0 && updates.size === 0) return;
    pendingEstimatesRef.current = new Map();
    pendingVenueUpdatesRef.current = new Map();

    setVenues(prev => {
      let changed = false;
      const next = prev.map(v => {
        const upd = updates.get(v.id);
        const est = estimates.get(v.id);
        if (!upd && !est) return v;
        let row = v;
        if (upd) {
          // Preserve the nested headcount_estimates array when merging
          row = { ...row, ...upd, headcount_estimates: row.headcount_estimates };
        }
        if (est && !sameEstimate(row.headcount_estimates[0], est[0])) {
          row = { ...row, headcount_estimates: est };
        }
        if (row !== v) changed = true;
        return row;
      });
      return changed ? next : prev;
    });
    scheduleCacheWrite();
  }, [scheduleCacheWrite]);

  const scheduleFlush = useCallback(() => {
    if (flushRafRef.current !== null) return;
    flushRafRef.current = requestAnimationFrame(flushPending);
  }, [flushPending]);

  useEffect(() => () => {
    if (flushRafRef.current !== null) cancelAnimationFrame(flushRafRef.current);
    if (cacheTimerRef.current !== null) clearTimeout(cacheTimerRef.current);
  }, []);

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
          const prev = pendingVenueUpdatesRef.current.get(updated.id);
          pendingVenueUpdatesRef.current.set(updated.id, { ...prev, ...updated });
          scheduleFlush();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [scheduleFlush]);

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
          const venueId = row?.venue_id
            ?? (payload.old as { venue_id?: string } | null)?.venue_id;
          if (!venueId) return;
          pendingEstimatesRef.current.set(
            venueId,
            payload.eventType === 'DELETE' ? [] : normalizeEstimates(toEstimate(payload.new)),
          );
          scheduleFlush();
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [scheduleFlush]);

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

  const refetch = useCallback(() => { fetchVenues(); }, [fetchVenues]);

  return {
    venues,
    loading,
    error,
    refetch,
  };
}
