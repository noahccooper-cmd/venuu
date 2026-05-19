import { useMemo } from 'react';
import { CITIES, type CityKey } from '../lib/constants';
import { useVenuesInBounds, type MapBounds } from './useVenuesInBounds';

/**
 * @deprecated Use useVenuesInBounds directly with the map's visible bounds.
 *
 * This wrapper exists for backward compatibility during the SEC -> bounds
 * migration. It computes a generous bounds box around the city center and
 * delegates to useVenuesInBounds.
 */
export function useVenues(city: CityKey) {
  const bounds = useMemo<MapBounds>(() => {
    const center = CITIES[city]?.center ?? CITIES.knoxville.center;
    const latPad = 0.36;
    const lngPad = 0.42;
    return {
      swLat: center.lat - latPad,
      swLng: center.lng - lngPad,
      neLat: center.lat + latPad,
      neLng: center.lng + lngPad,
    };
  }, [city]);

  return useVenuesInBounds(bounds);
}
