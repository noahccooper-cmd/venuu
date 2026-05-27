/**
 * Returns the set of venue IDs the current user has captured.
 * Wraps useMyRecaps to expose a Set<string> for O(1) lookups
 * in the map rendering hot paths.
 *
 * The Set is referentially stable until myRecaps changes — so
 * downstream useEffect/useMemo dependencies don't fire unless
 * the user actually captures a new venue.
 */

import { useMemo } from 'react';
import { useMyRecaps } from './useMyRecaps';

export function useMyVenueIds(username: string | null): Set<string> {
  const { recaps } = useMyRecaps(username);

  return useMemo(() => {
    return new Set(recaps.map(r => r.venue_id));
  }, [recaps]);
}
