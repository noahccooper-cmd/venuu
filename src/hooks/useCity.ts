import { useState, useCallback } from 'react';
import { CITIES, type CityKey } from '../lib/constants';

export function useCity() {
  const [city, setCity] = useState<CityKey>(() => {
    const stored = localStorage.getItem('venue_city');
    if (stored && stored in CITIES) {
      console.debug('[city] Loaded from storage:', stored);
      return stored as CityKey;
    }
    console.debug('[city] No saved city, defaulting to knoxville');
    return 'knoxville';
  });

  const switchCity = useCallback((newCity: CityKey) => {
    console.debug('[city] Changed to:', newCity);
    setCity(newCity);
    localStorage.setItem('venue_city', newCity);
  }, []);

  return { city, switchCity };
}
