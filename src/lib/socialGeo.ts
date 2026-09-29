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
