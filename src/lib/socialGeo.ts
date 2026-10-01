import { CITIES, type CityKey } from './constants';

export const SOCIAL_CITIES: CityKey[] = ['knoxville', 'tampa', 'st_petersburg'];

type LngLat = [number, number];

/** Pinellas = st_petersburg key; covers St. Pete, Clearwater, Dunedin, beaches. */
export const PINELLAS_BOUNDS: [LngLat, LngLat] = [[-82.86, 27.60], [-82.55, 28.10]];

export interface SocialCityGeo {
  /** Where the city marker sits on the globe and where the fly-down lands. */
  center: LngLat;
  /** City-map framing: fitBounds when set, else center + zoom. */
  bounds: [LngLat, LngLat] | null;
  zoom: number;
}

export const SOCIAL_CITY_GEO: Record<CityKey, SocialCityGeo> = {
  knoxville: {
    center: [CITIES.knoxville.center.lng, CITIES.knoxville.center.lat],
    bounds: null,
    zoom: 13.2,
  },
  tampa: {
    center: [CITIES.tampa.center.lng, CITIES.tampa.center.lat],
    bounds: null,
    zoom: 12.2,
  },
  st_petersburg: {
    // Globe pin sits on St. Pete itself; the city screen frames all of Pinellas.
    center: [CITIES.st_petersburg.center.lng, CITIES.st_petersburg.center.lat],
    bounds: PINELLAS_BOUNDS,
    zoom: 10,
  },
};

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

type Pt = [number, number];

/** Great-circle distance in km between two [lng, lat] points. */
export function distanceKm(a: Pt, b: Pt): number {
  const r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r;
  const dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The Social city whose center is closest to a point. */
export function nearestCity(p: Pt): CityKey {
  let best: CityKey = SOCIAL_CITIES[0];
  let bestD = Infinity;
  for (const c of SOCIAL_CITIES) {
    const d = distanceKm(p, SOCIAL_CITY_GEO[c].center);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/** [[w, s], [e, n]] around a set of points, or null when empty. */
export function boundsOf(points: Pt[]): [Pt, Pt] | null {
  if (points.length === 0) return null;
  const lngs = points.map(p => p[0]);
  const lats = points.map(p => p[1]);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

/** Tampa Bay framing — both Tampa and St. Pete. */
export const TAMPA_BAY_BOUNDS: [Pt, Pt] = [[-82.86, 27.65], [-82.40, 28.05]];
