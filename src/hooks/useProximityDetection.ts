import { useEffect, useRef } from 'react';
import { supabase, envReady } from '../lib/supabase';
import { recordSignal } from '../lib/signals';
import type { Venue } from '../lib/types';

/**
 * useProximityDetection — the passive-discovery engine.
 *
 * For every fresh GPS fix we receive from useUserLocation, we compute
 * the distance to every venue in the current city. State transitions:
 *
 *   • Distance ≤ ENTER_RADIUS  → log 'enter' presence_event (once
 *     per visit), record firstSeenAt in memory.
 *   • Stays inside (with hysteresis: stay until > EXIT_RADIUS) →
 *     every STILL_PRESENT_MS interval, log a 'still_present' event
 *     so the eventual user_visit row gets a fresh last_seen_at.
 *   • Distance > EXIT_RADIUS while previously inside → log 'exit'
 *     event, move to pendingExits with exitedAt = now.
 *   • A pending exit older than EXIT_COOLDOWN_MS without a re-entry
 *     gets promoted into user_visits as a confirmed visit.
 *
 * State lives in refs (not React state) because GPS updates are
 * frequent and we don't want to re-render the whole tree on every
 * tick. The hook is a pure side-effect engine — no return value.
 *
 * Privacy: no-op if userId (profile.id) is null, so guest sessions
 * never write presence_events.
 */

interface NearbyEntry {
  firstSeenAt: number;     // ms timestamp of first ENTER
  lastPingedAt: number;    // ms timestamp of last server log
}

interface PendingExit {
  firstSeenAt: number;
  exitedAt: number;
  lastDistanceM: number;
}

interface UseProximityDetectionArgs {
  userLat: number | null;
  userLng: number | null;
  userAccuracy: number | null;
  venues: Venue[];
  enabled: boolean;
  /** profiles.id — NOT auth.users.id (user_visits FKs to profiles). */
  userId: string | null;
  /** Distance (m) below which a venue counts as entered. Default 60. */
  enterRadiusM?: number;
  /** Distance (m) above which we consider a venue exited. Default 100.
   *  Hysteresis: enterRadius < exitRadius so a user hovering near the
   *  boundary doesn't ping enter/exit repeatedly. */
  exitRadiusM?: number;
  /** Optional event hook — fires with the venue id on each confirmed
   *  ENTER. Used by App.tsx to mark active-plan stops as visited. */
  onVenueEnter?: (venueId: string) => void;
}

const STILL_PRESENT_MS = 5 * 60_000;   // keep last_seen fresh every 5 min
const EXIT_COOLDOWN_MS = 20 * 60_000;  // 20 min outside → confirmed visit
const MAX_ACCEPTABLE_ACCURACY_M = 100; // skip fixes worse than this

// Prediction-engine signal cadences — independent of presence_events. The
// engine's TTL is generous (30 min for foreground, longer for background),
// but we don't want to fire 50 signals when a user idles inside a bar.
const SIGNAL_FOREGROUND_RATE_LIMIT_MS = 5  * 60_000;  // once per venue per 5  min
const SIGNAL_BACKGROUND_RATE_LIMIT_MS = 15 * 60_000;  // once per venue per 15 min

/** YYYY-MM-DD in local time, with visits before 8am rolled to the
 *  previous calendar night. Matches the migration's CASE WHEN logic.
 *  Exported so plan-stop writes use the same rollover as passive
 *  visits — the (user, venue, night_of) unique constraint depends on
 *  both code paths agreeing. */
export function computeNightOf(dt: Date): string {
  const adjusted = new Date(dt);
  if (adjusted.getHours() < 8) {
    adjusted.setDate(adjusted.getDate() - 1);
  }
  const y = adjusted.getFullYear();
  const m = String(adjusted.getMonth() + 1).padStart(2, '0');
  const d = String(adjusted.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
          * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function confidenceForDuration(durationMs: number): number {
  if (durationMs >= 10 * 60_000) return 100;
  if (durationMs >= 5  * 60_000) return 70;
  return 50;
}

export function useProximityDetection({
  userLat,
  userLng,
  userAccuracy,
  venues,
  enabled,
  userId,
  enterRadiusM = 60,
  exitRadiusM = 100,
  onVenueEnter,
}: UseProximityDetectionArgs): void {
  // Live state lives in refs so frequent GPS updates don't trigger
  // React re-renders for the rest of the app.
  const nearbyRef = useRef<Map<string, NearbyEntry>>(new Map());
  const pendingExitsRef = useRef<Map<string, PendingExit>>(new Map());

  // Last-fired-at per venue per signal type — keys are
  // `${venueId}:${signalType}`. Local rate-limit only; the engine
  // doesn't see these timestamps.
  const lastSignalAtRef = useRef<Map<string, number>>(new Map());

  // Track latest callback in a ref so we don't restart the effect
  // every time the parent passes a new arrow function.
  const onEnterRef = useRef(onVenueEnter);
  onEnterRef.current = onVenueEnter;

  // Diagnostic — count venues with unusable coords. Logs once per
  // change in venue-count so seed-data anomalies surface in dev
  // without spamming the console on every GPS fix.
  useEffect(() => {
    if (!enabled || !venues.length) return;
    let invalid = 0;
    for (const v of venues) {
      if (v.lat == null || v.lng == null) { invalid++; continue; }
      if (typeof v.lat !== 'number' || typeof v.lng !== 'number') { invalid++; continue; }
      if (Number.isNaN(v.lat) || Number.isNaN(v.lng)) { invalid++; continue; }
      if (Math.abs(v.lat) < 0.001 && Math.abs(v.lng) < 0.001) { invalid++; continue; }
      if (Math.abs(v.lat) > 90 || Math.abs(v.lng) > 180) { invalid++; continue; }
    }
    if (invalid > 0) {
      console.warn(
        `[proximity] ${invalid}/${venues.length} venues have invalid coords — they won't be discoverable passively`,
      );
    }
  }, [enabled, venues.length, venues]);

  // Periodic sweep that promotes pendingExits after EXIT_COOLDOWN_MS,
  // independent of new GPS fixes arriving.
  useEffect(() => {
    if (!enabled || !userId || !envReady) return;
    const interval = setInterval(() => {
      void sweepPendingExits(userId);
    }, 60_000); // sweep once a minute
    return () => clearInterval(interval);
  }, [enabled, userId]);

  // Main per-fix effect.
  useEffect(() => {
    if (!enabled || !userId || !envReady) return;
    if (userLat == null || userLng == null) return;
    // Reject bad GPS fixes — they create false positives at scale.
    if (userAccuracy == null || userAccuracy > MAX_ACCEPTABLE_ACCURACY_M) return;
    if (!venues.length) return;

    const nowMs = Date.now();
    const nearby = nearbyRef.current;
    const pending = pendingExitsRef.current;

    for (const v of venues) {
      // Defensive: reject any venue that can't meaningfully be tested
      // for proximity. The DB layer is supposed to enforce lat/lng but
      // a single seed row with bad coords would otherwise pollute the
      // ENTER stream with false positives near (0,0).
      if (v.lat == null || v.lng == null) continue;
      if (typeof v.lat !== 'number' || typeof v.lng !== 'number') continue;
      if (Number.isNaN(v.lat) || Number.isNaN(v.lng)) continue;
      if (Math.abs(v.lat) < 0.001 && Math.abs(v.lng) < 0.001) continue; // (0,0)
      if (Math.abs(v.lat) > 90 || Math.abs(v.lng) > 180) continue;       // out of range
      const dist = haversineMeters(userLat, userLng, v.lat, v.lng);

      const wasInside = nearby.has(v.id);

      if (dist <= enterRadiusM) {
        if (!wasInside) {
          // ── ENTER ──
          // If we had a pendingExit for this venue, the user came back
          // before the cooldown — restore them as still-inside.
          const resumed = pending.get(v.id);
          pending.delete(v.id);
          nearby.set(v.id, {
            firstSeenAt: resumed?.firstSeenAt ?? nowMs,
            lastPingedAt: nowMs,
          });
          void logEvent(userId, v.id, 'enter', dist, userAccuracy);
          emitProximitySignal(v.id, lastSignalAtRef.current, nowMs);
          onEnterRef.current?.(v.id);
        } else {
          // ── STILL_PRESENT (keep last_seen fresh, but throttled) ──
          const entry = nearby.get(v.id)!;
          if (nowMs - entry.lastPingedAt >= STILL_PRESENT_MS) {
            entry.lastPingedAt = nowMs;
            void logEvent(userId, v.id, 'still_present', dist, userAccuracy);
            emitProximitySignal(v.id, lastSignalAtRef.current, nowMs);
          }
        }
      } else if (dist > exitRadiusM && wasInside) {
        // ── EXIT (with hysteresis gap between enter and exit radii) ──
        const entry = nearby.get(v.id)!;
        nearby.delete(v.id);
        pending.set(v.id, {
          firstSeenAt: entry.firstSeenAt,
          exitedAt: nowMs,
          lastDistanceM: Math.round(dist),
        });
        void logEvent(userId, v.id, 'exit', dist, userAccuracy);
      }
    }

    // Opportunistic sweep too — saves a wait when the user's already
    // sitting on a stale pending exit when the next fix arrives.
    void sweepPendingExits(userId);
  }, [enabled, userId, userLat, userLng, userAccuracy, venues, enterRadiusM, exitRadiusM]);

  // ── Promotion of pending exits → confirmed user_visits ──
  // Pulled out as a stable closure so both the per-fix effect and the
  // interval sweep can call it. Reads from the same ref so state is
  // consistent regardless of trigger source.
  async function sweepPendingExits(forUserId: string) {
    const nowMs = Date.now();
    const pending = pendingExitsRef.current;
    const promoted: string[] = [];

    for (const [venueId, exit] of pending.entries()) {
      if (nowMs - exit.exitedAt < EXIT_COOLDOWN_MS) continue;
      const durationMs = exit.exitedAt - exit.firstSeenAt;
      const durationMin = Math.min(480, Math.max(0, Math.round(durationMs / 60_000)));
      const confidence = confidenceForDuration(durationMs);
      const firstSeenISO = new Date(exit.firstSeenAt).toISOString();
      const lastSeenISO = new Date(exit.exitedAt).toISOString();
      const nightOf = computeNightOf(new Date(exit.firstSeenAt));

      try {
        // ON CONFLICT — if a row already exists for this triple (e.g.
        // user popped out + popped back + left again), extend the
        // last_seen_at + recompute duration_min. We re-issue an upsert
        // rather than UPDATE-OR-INSERT manually so RLS only sees one
        // statement.
        const { data: visitRow, error } = await supabase
          .from('user_visits')
          .upsert(
            {
              user_id: forUserId,
              venue_id: venueId,
              night_of: nightOf,
              first_seen_at: firstSeenISO,
              last_seen_at: lastSeenISO,
              duration_min: durationMin,
              source: 'passive',
              confidence,
            },
            { onConflict: 'user_id,venue_id,night_of', ignoreDuplicates: false },
          )
          .select()
          .single();
        if (error) {
          console.warn('[proximity] user_visits upsert failed:', error.message);
        } else {
          promoted.push(venueId);

          // PHASE D: queue a paint prompt for this visit.
          // The edge function checks eligibility (20+ min, not already painted)
          // and sets fire_not_before to last_seen_at + 5 min. The minute-cron
          // 'paint-prompt-sweep' then fires the actual push when fire_not_before
          // is reached. Non-blocking — if this fails, the user_visit is still
          // recorded and all other engine signals still fire normally.
          if (visitRow?.id) {
            try {
              await supabase.functions.invoke('paint-exit-prompt', {
                body: { user_visit_id: visitRow.id },
              });
            } catch (paintErr) {
              console.warn('[useProximityDetection] paint-exit-prompt queue failed', paintErr);
            }
          }
        }
      } catch (err) {
        console.warn('[proximity] sweep threw:', err);
      }
    }

    for (const id of promoted) pending.delete(id);
  }
}

/** Fire a prediction-engine signal for being inside a venue geofence.
 *  Foreground (tab visible) → `app_open_in_geofence`, rate-limited 5 min.
 *  Background (tab hidden)  → `background_presence`, rate-limited 15 min.
 *  recordSignal is fire-and-forget so the proximity tick is never blocked. */
function emitProximitySignal(
  venueId: string,
  lastByKey: Map<string, number>,
  nowMs: number,
): void {
  const isBg = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  const signalType: 'app_open_in_geofence' | 'background_presence' =
    isBg ? 'background_presence' : 'app_open_in_geofence';
  const limit = isBg ? SIGNAL_BACKGROUND_RATE_LIMIT_MS : SIGNAL_FOREGROUND_RATE_LIMIT_MS;
  const key = `${venueId}:${signalType}`;
  const last = lastByKey.get(key);
  if (last !== undefined && nowMs - last < limit) return;
  lastByKey.set(key, nowMs);

  recordSignal({
    venueId,
    signalType,
    metadata: { source: 'useProximityDetection', is_background: isBg },
  });
  console.log(`[signal] ${signalType} venue=${venueId.slice(0, 8)} bg=${isBg}`);
}

/** Best-effort presence_event insert. Errors are logged but swallowed —
 *  a transient network blip shouldn't kill the proximity engine. */
async function logEvent(
  userId: string,
  venueId: string,
  eventType: 'enter' | 'still_present' | 'exit',
  distanceM: number,
  accuracyM: number | null,
): Promise<void> {
  try {
    const { error } = await supabase
      .from('presence_events')
      .insert({
        user_id: userId,
        venue_id: venueId,
        event_type: eventType,
        distance_m: Math.round(distanceM),
        accuracy_m: accuracyM != null ? Math.round(accuracyM) : null,
      });
    if (error) {
      console.warn('[proximity] presence_events insert failed:', error.message);
    }
  } catch (err) {
    console.warn('[proximity] event insert threw:', err);
  }
}
