import { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

const GEOFENCE_RADIUS_M = 200;

/** Haversine distance in meters between two lat/lng points */
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface GeofenceState {
  /** True ONLY when we have a confirmed GPS fix within 200m */
  isNearVenue: boolean;
  distance: number | null;
  loading: boolean;
  error: string | null;
  /** True once at least one valid position has been received */
  hasPosition: boolean;
}

export function useGeofence(venueLat: number, venueLng: number): GeofenceState {
  const [isNearVenue, setIsNearVenue] = useState(false);
  const [distance, setDistance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasPosition, setHasPosition] = useState(false);
  const watchIdRef = useRef<string | number | null>(null);

  useEffect(() => {
    let cancelled = false;

    function updatePosition(lat: number, lng: number, accuracy?: number) {
      if (cancelled) return;

      // If GPS accuracy is too poor (or missing), don't trust it
      if (accuracy === undefined || accuracy === null || accuracy > 100) {
        console.log('GEOFENCE DEBUG: poor accuracy or missing, rejecting', { accuracy });
        setIsNearVenue(false);
        setDistance(null);
        setLoading(false);
        return;
      }

      const d = haversine(lat, lng, venueLat, venueLng);
      const rounded = Math.round(d);
      const isNear = rounded <= GEOFENCE_RADIUS_M;

      console.log('GEOFENCE DEBUG:', {
        userLat: lat,
        userLng: lng,
        venueLat,
        venueLng,
        calculatedDistance: rounded,
        isNear,
        accuracy,
      });

      setDistance(rounded);
      setIsNearVenue(isNear);
      setHasPosition(true);
      setLoading(false);
    }

    function handleError() {
      if (cancelled) return;
      setIsNearVenue(false);
      setDistance(null);
      setError('Location unavailable');
      setLoading(false);
    }

    async function startNative() {
      try {
        const perm = await Geolocation.checkPermissions();
        if (perm.location === 'denied') {
          // Try requesting once
          const req = await Geolocation.requestPermissions();
          if (req.location === 'denied') {
            handleError();
            return;
          }
        }

        const id = await Geolocation.watchPosition(
          { enableHighAccuracy: true },
          (pos, err) => {
            if (err || !pos) {
              handleError();
              return;
            }
            updatePosition(
              pos.coords.latitude,
              pos.coords.longitude,
              pos.coords.accuracy,
            );
          },
        );
        if (!cancelled) {
          watchIdRef.current = id;
        } else {
          await Geolocation.clearWatch({ id });
        }
      } catch {
        handleError();
      }
    }

    function startWeb() {
      if (!navigator.geolocation) {
        handleError();
        return;
      }
      const id = navigator.geolocation.watchPosition(
        (pos) => {
          updatePosition(
            pos.coords.latitude,
            pos.coords.longitude,
            pos.coords.accuracy,
          );
        },
        () => handleError(),
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
  }, [venueLat, venueLng]);

  return { isNearVenue, distance, loading, error, hasPosition };
}
