import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

/**
 * useUserLocation — foreground GPS polling.
 *
 *   • Wraps @capacitor/geolocation on native, falls back to
 *     navigator.geolocation on web.
 *   • Watches position with `pollIntervalMs` desired cadence (the
 *     underlying watchPosition fires when the OS gets a fix; we
 *     additionally re-arm a one-shot getCurrentPosition every
 *     `pollIntervalMs` on web so devs/testers spoofing in DevTools
 *     see updates without having to physically move).
 *   • Exposes `permissionStatus` for the LocationPermissionCard.
 *   • Returns the legacy `{lat,lng,accuracy}` location object too
 *     so TonightPage / MapView consumers keep working unchanged.
 *
 * v1: foreground / "While Using" only. No background tracking.
 */

export interface UserLocation {
  lng: number;
  lat: number;
  accuracy: number; // meters
}

export type PermissionStatus = 'unknown' | 'granted' | 'denied' | 'prompt';

export interface UseUserLocationOptions {
  enabled?: boolean;
  pollIntervalMs?: number;
  highAccuracy?: boolean;
}

export interface UseUserLocationResult {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  lastUpdated: number | null;
  permissionStatus: PermissionStatus;
  isWatching: boolean;
  /** Legacy back-compat for existing TonightPage + MapView consumers. */
  location: UserLocation | null;
  /** Force a one-shot getCurrentPosition (e.g. tapping a prompt). */
  refresh: () => Promise<void>;
  /** Trigger the native permission prompt explicitly. Resolves to the
   *  new status. Useful for the "Allow location" CTA card. */
  requestPermission: () => Promise<PermissionStatus>;
}

/**
 * Legacy positional signature — `useUserLocation()` and
 * `useUserLocation(true)` are supported for backward compatibility
 * with code paths that aren't yet ready to pass an options object.
 * The shape returned still includes the new fields, so old code
 * that only reads `.lat / .lng / .accuracy` keeps working.
 */
export function useUserLocation(
  arg?: UseUserLocationOptions | boolean,
): UseUserLocationResult {
  const opts: UseUserLocationOptions = typeof arg === 'boolean'
    ? { enabled: arg }
    : (arg ?? {});
  const enabled = opts.enabled ?? true;
  const pollIntervalMs = opts.pollIntervalMs ?? 60_000;
  const highAccuracy = opts.highAccuracy ?? false;

  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('unknown');
  const [isWatching, setIsWatching] = useState(false);

  const watchIdRef = useRef<string | number | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  const acceptFix = useCallback((p: { latitude: number; longitude: number; accuracy: number }) => {
    if (cancelledRef.current) return;
    setLat(p.latitude);
    setLng(p.longitude);
    setAccuracy(p.accuracy);
    setLastUpdated(Date.now());
  }, []);

  // ── Permission probe ──
  const checkPermission = useCallback(async (): Promise<PermissionStatus> => {
    try {
      if (Capacitor.isNativePlatform()) {
        const perm = await Geolocation.checkPermissions();
        // Capacitor returns 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'
        const mapped: PermissionStatus = perm.location === 'granted'
          ? 'granted'
          : perm.location === 'denied'
            ? 'denied'
            : 'prompt';
        setPermissionStatus(mapped);
        return mapped;
      }
      // Web — use the Permissions API where available.
      if ('permissions' in navigator && typeof navigator.permissions.query === 'function') {
        try {
          const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
          const mapped: PermissionStatus = status.state === 'granted'
            ? 'granted'
            : status.state === 'denied'
              ? 'denied'
              : 'prompt';
          setPermissionStatus(mapped);
          return mapped;
        } catch {
          // Some browsers (older Safari) throw on { name: 'geolocation' }.
        }
      }
      setPermissionStatus('prompt');
      return 'prompt';
    } catch {
      setPermissionStatus('unknown');
      return 'unknown';
    }
  }, []);

  const requestPermission = useCallback(async (): Promise<PermissionStatus> => {
    try {
      if (Capacitor.isNativePlatform()) {
        const res = await Geolocation.requestPermissions({ permissions: ['location'] });
        const mapped: PermissionStatus = res.location === 'granted'
          ? 'granted'
          : res.location === 'denied'
            ? 'denied'
            : 'prompt';
        setPermissionStatus(mapped);
        return mapped;
      }
      // Web — there's no separate "request" API, the act of calling
      // getCurrentPosition triggers the browser prompt.
      return await new Promise<PermissionStatus>(resolve => {
        if (!navigator.geolocation) {
          setPermissionStatus('denied');
          resolve('denied');
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            acceptFix({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            });
            setPermissionStatus('granted');
            resolve('granted');
          },
          (err) => {
            const denied = err.code === err.PERMISSION_DENIED;
            const next: PermissionStatus = denied ? 'denied' : 'unknown';
            setPermissionStatus(next);
            resolve(next);
          },
          { enableHighAccuracy: highAccuracy, timeout: 10_000, maximumAge: 30_000 },
        );
      });
    } catch {
      setPermissionStatus('unknown');
      return 'unknown';
    }
  }, [acceptFix, highAccuracy]);

  const refresh = useCallback(async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: highAccuracy,
          timeout: 10_000,
          maximumAge: 30_000,
        });
        acceptFix({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      } else if (navigator.geolocation) {
        await new Promise<void>(resolve => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              acceptFix({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
              });
              resolve();
            },
            () => resolve(),
            { enableHighAccuracy: highAccuracy, timeout: 10_000, maximumAge: 30_000 },
          );
        });
      }
    } catch {
      /* silent */
    }
  }, [acceptFix, highAccuracy]);

  // ── Main effect: arm watch + heartbeat poll when enabled+granted. ──
  useEffect(() => {
    cancelledRef.current = false;
    if (!enabled) {
      setIsWatching(false);
      return;
    }

    let armed = true;

    async function arm() {
      const perm = await checkPermission();
      if (perm === 'denied') {
        setIsWatching(false);
        return;
      }
      if (!armed) return;

      const watchOpts = {
        enableHighAccuracy: highAccuracy,
        timeout: 10_000,
        maximumAge: 30_000,
      };

      if (Capacitor.isNativePlatform()) {
        try {
          const id = await Geolocation.watchPosition(watchOpts, (pos, err) => {
            if (err || !pos) return;
            acceptFix({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            });
          });
          if (!armed) {
            await Geolocation.clearWatch({ id });
            return;
          }
          watchIdRef.current = id;
          setIsWatching(true);
        } catch {
          setIsWatching(false);
        }
      } else if (navigator.geolocation) {
        try {
          const id = navigator.geolocation.watchPosition(
            (pos) => acceptFix({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            }),
            (err) => {
              if (err.code === err.PERMISSION_DENIED) {
                setPermissionStatus('denied');
              }
            },
            watchOpts,
          );
          watchIdRef.current = id;
          setIsWatching(true);
        } catch {
          setIsWatching(false);
        }
      }

      // Heartbeat — periodically refresh so the proximity detector
      // gets a fresh tick even if the OS isn't pushing watch updates
      // (devs spoofing locations in DevTools, stationary user, etc.).
      pollTimerRef.current = setInterval(() => { void refresh(); }, pollIntervalMs);
    }

    arm();

    return () => {
      armed = false;
      cancelledRef.current = true;
      setIsWatching(false);
      const id = watchIdRef.current;
      if (id != null) {
        if (Capacitor.isNativePlatform()) {
          Geolocation.clearWatch({ id: id as string }).catch(() => {});
        } else if (navigator.geolocation) {
          navigator.geolocation.clearWatch(id as number);
        }
        watchIdRef.current = null;
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [enabled, highAccuracy, pollIntervalMs, acceptFix, checkPermission, refresh]);

  // Legacy back-compat — TonightPage + MapView read `{lat,lng,accuracy}`
  // directly. Build it only when we have a fix.
  const location: UserLocation | null = (lat != null && lng != null)
    ? { lat, lng, accuracy: accuracy ?? 0 }
    : null;

  return {
    lat,
    lng,
    accuracy,
    lastUpdated,
    permissionStatus,
    isWatching,
    location,
    refresh,
    requestPermission,
  };
}
