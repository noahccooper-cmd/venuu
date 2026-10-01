import { CITIES, type CityKey } from './constants';

/**
 * Canonical city keys — the exact values stored in `events.city` and
 * `venues.city`. Every events query that filters by city goes through
 * `toCityKey` and matches with `.eq('city', key)`, never ILIKE.
 *
 * Aliases cover the display / slug variants found across the codebase
 * ("St. Petersburg", "St Pete", "stpete", "ST_PETE", "Pinellas", …) so
 * UI labels can't leak into a query as a non-matching city string.
 */
const ALIASES: Record<string, CityKey> = {
  knoxville: 'knoxville',
  knox: 'knoxville',
  tampa: 'tampa',
  st_petersburg: 'st_petersburg',
  stpetersburg: 'st_petersburg',
  st_pete: 'st_petersburg',
  stpete: 'st_petersburg',
  pinellas: 'st_petersburg',
};

/** Normalize any city string to its canonical key, or null if unknown. */
export function toCityKey(input: string | null | undefined): CityKey | null {
  if (!input) return null;
  const slug = input.trim().toLowerCase().replace(/\./g, '').replace(/[\s-]+/g, '_');
  const key = ALIASES[slug] ?? ALIASES[slug.replace(/_/g, '')];
  return key && key in CITIES ? key : null;
}

/** True when a row's city belongs to the given city (both normalized). */
export function isSameCity(rowCity: string | null | undefined, city: string | null | undefined): boolean {
  const a = toCityKey(rowCity);
  return a !== null && a === toCityKey(city);
}
