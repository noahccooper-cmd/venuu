import { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

export interface UserLocation {
  lng: number;
  lat: number;
  accuracy: number; // meters
}

/**
 * Continuously tracks the user's GPS position via watchPosition.
 * Returns the latest position or null if unavailable.
 * Only activates when `enabled` is true (default: true).
 */
export function useUserLocation(enabled = true) {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const watchIdRef = useRef<string | number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    function onPosition(lat: number, lng: number, accuracy: number) {
      if (cancelled) return;
      setLocation({ lat, lng, accuracy });
    }

    function onError() {
      // Silently fail — location dot just won't show
    }

    async function startNative() {
      try {
        const perm = await Geolocation.checkPermissions();
        if (perm.location === 'denied') return;

        const id = await Geolocation.watchPosition(
          { enableHighAccuracy: true },
          (pos, err) => {
            if (err || !pos) return;
            onPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
          },
        );
        if (!cancelled) {
          watchIdRef.current = id;
        } else {
          await Geolocation.clearWatch({ id });
        }
      } catch {
        onError();
      }
    }

    function startWeb() {
      if (!navigator.geolocation) return;
      const id = navigator.geolocation.watchPosition(
        (pos) => onPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
        () => onError(),
        { enableHighAccuracy: true },
      );
      watchIdRef.current = id;
    }

    if (Capacitor.isNativePlatform()) {
      startNative();
    } else {
      startWeb();
    }

    return () => {
      cancelled = true;
      const id = watchIdRef.current;
      if (id !== null) {
        if (Capacitor.isNativePlatform()) {
          Geolocation.clearWatch({ id: id as string });
        } else {
          navigator.geolocation.clearWatch(id as number);
        }
        watchIdRef.current = null;
      }
    };
  }, [enabled]);

  return location;
}
