const defaultCountLabel = (count: number) =>
  count === 0
    ? 'See who\u2019s going out tonight'
    : `${count.toLocaleString()} people out right now`;

/**
 * venuu markets \u2014 cities where venues are seeded.
 *
 * After the SEC architecture removal (May 2026), this is no longer used to
 * filter venue queries. The map reads venues by lat/lng bounds. CITIES is
 * kept for: header copy, market-aware analytics, push notification
 * topic-subscription, and a fallback center when GPS is denied.
 */
export const CITIES = {
  knoxville: {
    name: 'Knoxville',
    state: 'TN',
    school: 'UTK',
    mascot: 'Vols',
    dbCity: 'knoxville',
    center: { lat: 35.9570, lng: -83.9275 },
    zoom: 14.5,
    countLabel: defaultCountLabel,
  },
  tampa: {
    name: 'Tampa',
    state: 'FL',
    school: 'USF',
    mascot: 'Bulls',
    dbCity: 'tampa',
    center: { lat: 27.9506, lng: -82.4572 },
    zoom: 13.5,
    countLabel: defaultCountLabel,
  },
  st_petersburg: {
    name: 'St. Petersburg',
    state: 'FL',
    school: 'USF',
    mascot: 'Bulls',
    dbCity: 'st_petersburg',
    center: { lat: 27.7706, lng: -82.6398, },
    zoom: 14.0,
    countLabel: defaultCountLabel,
  },
} as const;

export type CityKey = keyof typeof CITIES;

/**
 * Default fallback city when location is denied or unavailable.
 */
export const DEFAULT_CITY: CityKey = 'knoxville';

/**
 * Determine which venuu market a given lat/lng is closest to.
 * Returns null if outside any market's reasonable radius (~50 miles).
 */
export function nearestMarket(lat: number, lng: number): CityKey | null {
  const MAX_DISTANCE_MILES = 50;
  let closest: CityKey | null = null;
  let closestDistance = Infinity;

  for (const key of Object.keys(CITIES) as CityKey[]) {
    const c = CITIES[key].center;
    const dLat = (lat - c.lat) * 69;
    const dLng = (lng - c.lng) * 54.6;
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);
    if (dist < closestDistance && dist < MAX_DISTANCE_MILES) {
      closest = key;
      closestDistance = dist;
    }
  }
  return closest;
}

export const COLORS = {
  bgPrimary: '#050507',
  bgSurface: '#111114',
  bgElevated: '#1A1A1F',
  border: '#2A2A30',
  borderGlow: '#FF5E1A33',
  accentPrimary: '#FF5E1A',
  accentHot: '#FF2D05',
  accentWarm: '#FFAA00',
  accentCool: '#4A4A52',
  accentSuccess: '#00E676',
  accentLive: '#00B4FF',
  accentClicker: '#FF5E1A',
  textPrimary: '#FFFFFF',
  textSecondary: '#8A8A95',
  textMuted: '#55555F',
} as const;

export const MAPBOX_STYLE = 'mapbox://styles/mapbox/dark-v11';
