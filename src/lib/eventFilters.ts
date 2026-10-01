import type { VenueEvent } from './types';

/**
 * Filter events to only those curated for display. The events table
 * has a `curated` boolean column controlled by venuu admins.
 */
export function filterEventsByCurated(
  events: (VenueEvent & { curated?: boolean })[]
): VenueEvent[] {
  return events.filter(e => e.is_active && e.curated === true);
}
