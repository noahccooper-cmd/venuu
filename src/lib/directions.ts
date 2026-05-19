/** Mapbox Walking Directions API utility. */

import { Capacitor } from '@capacitor/core';
import { recordSignal } from './signals';

/**
 * Open the user's native maps app pointed at a destination, walking
 * directions when the platform supports it. iOS resolves the
 * `maps://` scheme directly; web falls back to Google Maps.
 *
 * When venueId is supplied, fires a fire-and-forget `direction_request`
 * signal so the prediction engine sees this intent. Signal write never
 * blocks the deep-link — failures are swallowed.
 */
export function openDirectionsTo(
  lat: number,
  lng: number,
  venueName: string,
  venueId?: string,
): void {
  if (venueId) {
    recordSignal({
      venueId,
      signalType: 'direction_request',
      beforeNavigation: true,
      metadata: { source: 'openDirectionsTo', surface: 'venue_card' },
    });
    console.log(`[signal] direction_request venue=${venueId.slice(0, 8)}`);
  }
  if (Capacitor.isNativePlatform()) {
    // iOS Maps deep link. `dirflg=w` requests the walking route.
    const url = `maps://?daddr=${lat},${lng}&dirflg=w`;
    try {
      window.location.href = url;
    } catch { /* swallow */ }
    return;
  }
  const encoded = encodeURIComponent(venueName);
  const url =
    `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` +
    `&destination_place_id=${encoded}&travelmode=walking`;
  try {
    window.open(url, '_blank');
  } catch { /* swallow */ }
}

export interface WalkingRoute {
  geometry: GeoJSON.LineString;
  duration: number; // seconds
  distance: number; // meters
}

/**
 * Fetch a walking route from Mapbox Directions API.
 * Returns null on any error.
 */
export async function getWalkingRoute(
  from: [number, number], // [lng, lat]
  to: [number, number],   // [lng, lat]
  token: string,
  venueId?: string,
): Promise<WalkingRoute | null> {
  try {
    const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${from[0]},${from[1]};${to[0]},${to[1]}?geometries=geojson&overview=full&access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) return null;

    // PREDICTION ENGINE: log direction request as a signal
    if (venueId) {
      recordSignal({
        venueId,
        signalType: 'direction_request',
        metadata: {
          duration_seconds: route.duration,
          distance_meters: route.distance,
        },
      });
    }

    return {
      geometry: route.geometry as GeoJSON.LineString,
      duration: route.duration,
      distance: route.distance,
    };
  } catch {
    return null;
  }
}

/** Format seconds → "8 min" or "1 hr 15 min". */
export function formatWalkDuration(seconds: number): string {
  const mins = Math.ceil(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs} hr ${rem} min` : `${hrs} hr`;
}

/** Format meters → "800 ft" (under 0.15 mi) or "0.4 mi". */
export function formatWalkDistance(meters: number): string {
  const miles = meters / 1609.344;
  if (miles < 0.15) return `${Math.round(meters * 3.28084)} ft`;
  return `${miles.toFixed(1)} mi`;
}

/** Haversine distance in meters between two [lng, lat] points. */
export function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/**
 * Find the index of the closest coordinate on the route to the user's position.
 * Returns the index into coordinates[].
 */
export function findClosestPointIndex(
  coords: [number, number][],
  userPos: [number, number],
): number {
  let minDist = Infinity;
  let minIdx = 0;
  for (let i = 0; i < coords.length; i++) {
    const d = haversineMeters(coords[i], userPos);
    if (d < minDist) { minDist = d; minIdx = i; }
  }
  return minIdx;
}

/**
 * Slice the route to only include the portion AHEAD of the user.
 * Returns a new LineString with the walked portion removed.
 */
export function sliceRouteAhead(
  geometry: GeoJSON.LineString,
  userPos: [number, number],
): GeoJSON.LineString {
  const coords = geometry.coordinates as [number, number][];
  if (coords.length < 2) return geometry;
  const idx = findClosestPointIndex(coords, userPos);
  // Keep from the closest point onward (prepend user position for a clean line start)
  const ahead = [userPos, ...coords.slice(idx)];
  return { type: 'LineString', coordinates: ahead };
}

/**
 * Minimum distance from a point to any segment of the route line, in meters.
 */
export function distanceToRoute(
  coords: [number, number][],
  userPos: [number, number],
): number {
  const idx = findClosestPointIndex(coords, userPos);
  return haversineMeters(coords[idx], userPos);
}
