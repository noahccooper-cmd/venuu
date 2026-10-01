// ───────────────────────────────────────────────────────────────────
// src/lib/eventWindows.ts
//
// The engine behind events-mode: the time scrubber + beacon lighting.
//
// Pure functions over the real data contract (Venue / VenueEvent from
// types.ts). NO React, NO Mapbox — this is the brain that the scrubber
// UI and the map beacon layer both consume. Authored standalone so it
// drops in clean and can be unit-tested without the render layer.
//
// Concepts:
//   • A "beacon" is any venue hosting ≥1 live (curated, active, future)
//     event. Every other venue is a context dot.
//   • A "window" is a span of nights: tonight / this week / this month /
//     specials. Each window produces scrubber chips.
//   • For the selected chip we know which beacons are LIT (have an event
//     in that span). Beacons not lit go DORMANT. Non-beacons stay dots.
// ───────────────────────────────────────────────────────────────────

import type { VenueEvent } from './types';

export type EventWindow = 'tonight' | 'week' | 'month' | 'specials';

/** One tappable chip in the scrubber. Knows the span it covers and which
 *  venues light up for it. */
export interface WindowChip {
  id: string;
  window: EventWindow;
  kicker: string;        // small top label, e.g. "FRI", "WK", "★"
  primary: string;       // big label, e.g. "6", "Jun 8", "Weekly"
  sub?: string;          // optional footnote, e.g. "tonight", "recurring"
  isTonight?: boolean;
  rangeStart: number;    // epoch ms, inclusive
  rangeEnd: number;      // epoch ms, exclusive
  litVenueIds: string[]; // venues with an event inside this span
  eventCount: number;    // total events inside this span
}

/** Per-venue beacon facts, independent of the selected chip. */
export interface BeaconState {
  venueId: string;
  count: number;             // total live events at this venue
  marquee: boolean;          // any event flagged marquee → burns bigger
  soonest: VenueEvent | null;// next event chronologically (for the toast)
  hottest: VenueEvent | null;// highest going_count (for crowd×events glow)
  topGoing: number;          // hottest.going_count, normalized to a number
}

export type BeaconTier = 'lit' | 'dormant' | 'dot';

// nightlife "day" boundary — anything before 5am belongs to the prior night
const NIGHT_RESET_HOUR = 5;
const DAY = 86_400_000;
const WEEKDAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ms = (iso: string | null | undefined): number => (iso ? new Date(iso).getTime() : NaN);

/** Map a datetime to the 00:00 epoch of the night it belongs to. A 1am
 *  show counts as the night before, which is how people actually think. */
export function nightStart(epoch: number): number {
  const d = new Date(epoch);
  if (d.getHours() < NIGHT_RESET_HOUR) d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Events-mode shows curated, active, venue-anchored, unexpired events.
 *  `curated` is optional on older rows — we treat only an explicit
 *  `false` as hidden (flip to `=== true` if your column is fully backfilled). */
export function isLiveEvent(ev: VenueEvent, nowMs: number): boolean {
  if (ev.is_active === false) return false;
  if (ev.curated === false) return false;
  if (!ev.venue_id) return false;                       // must anchor to a beacon
  const exp = ms(ev.expires_at);
  if (!Number.isNaN(exp) && exp < nowMs) return false;  // already fell off
  return true;
}

const isSpecial = (ev: VenueEvent): boolean => ev.event_type === 'special';

// ── beacon states ──────────────────────────────────────────────────

/** Build the per-venue beacon map: every venue with ≥1 live event. */
export function buildBeacons(events: VenueEvent[], nowMs = Date.now()): Map<string, BeaconState> {
  const out = new Map<string, BeaconState>();
  for (const ev of events) {
    if (!isLiveEvent(ev, nowMs)) continue;
    const id = ev.venue_id as string;
    const going = ev.going_count ?? 0;
    const existing = out.get(id);
    if (!existing) {
      out.set(id, {
        venueId: id,
        count: 1,
        marquee: ev.marquee === true,
        soonest: ev,
        hottest: ev,
        topGoing: going,
      });
      continue;
    }
    existing.count += 1;
    existing.marquee = existing.marquee || ev.marquee === true;
    if (ms(ev.start_time) < ms(existing.soonest!.start_time)) existing.soonest = ev;
    if (going > existing.topGoing) { existing.hottest = ev; existing.topGoing = going; }
  }
  return out;
}

/** What a venue should look like for the currently selected chip. */
export function tierFor(
  venueId: string,
  litVenueIds: ReadonlyArray<string> | ReadonlySet<string>,
  beacons: Map<string, BeaconState>,
): BeaconTier {
  const lit = litVenueIds instanceof Set ? litVenueIds : new Set(litVenueIds);
  if (lit.has(venueId)) return 'lit';
  if (beacons.has(venueId)) return 'dormant';
  return 'dot';
}

// ── window / chip builders ─────────────────────────────────────────

function collect(live: VenueEvent[], start: number, end: number) {
  const ids = new Set<string>();
  let count = 0;
  for (const ev of live) {
    const t = ms(ev.start_time);
    if (t >= start && t < end) { ids.add(ev.venue_id as string); count += 1; }
  }
  return { litVenueIds: [...ids], eventCount: count };
}

/** Build every window's chips in one pass. Feed the result straight to
 *  the scrubber; pick a chip and read `litVenueIds`. */
export function buildWindows(
  events: VenueEvent[],
  nowMs = Date.now(),
): Record<EventWindow, WindowChip[]> {
  const live = events.filter((e) => isLiveEvent(e, nowMs));
  const tonightNight = nightStart(nowMs);

  // TONIGHT — single chip covering the current night
  const tonightSpan = { start: tonightNight, end: tonightNight + DAY };
  const tonightHit = collect(live, tonightSpan.start, tonightSpan.end);
  const td = new Date(tonightNight);
  const tonight: WindowChip[] = [{
    id: 'tonight',
    window: 'tonight',
    kicker: WEEKDAY[td.getDay()],
    primary: String(td.getDate()),
    sub: 'tonight',
    isTonight: true,
    rangeStart: tonightSpan.start,
    rangeEnd: tonightSpan.end,
    ...tonightHit,
  }];

  // THIS WEEK — the next 7 nights, one chip each
  const week: WindowChip[] = [];
  for (let i = 0; i < 7; i++) {
    const start = tonightNight + i * DAY;
    const end = start + DAY;
    const d = new Date(start);
    const hit = collect(live, start, end);
    week.push({
      id: `week-${i}`,
      window: 'week',
      kicker: WEEKDAY[d.getDay()],
      primary: String(d.getDate()),
      sub: i === 0 ? 'tonight' : undefined,
      isTonight: i === 0,
      rangeStart: start,
      rangeEnd: end,
      ...hit,
    });
  }

  // THIS MONTH — week buckets starting tonight, ~6 weeks out
  const month: WindowChip[] = [];
  for (let w = 0; w < 6; w++) {
    const start = tonightNight + w * 7 * DAY;
    const end = start + 7 * DAY;
    const d = new Date(start);
    const hit = collect(live, start, end);
    if (w > 0 && hit.eventCount === 0) continue; // skip empty future weeks, keep the first
    month.push({
      id: `month-${w}`,
      window: 'month',
      kicker: 'WK',
      primary: `${MONTH[d.getMonth()]} ${d.getDate()}`,
      sub: hit.eventCount ? `${hit.eventCount} event${hit.eventCount > 1 ? 's' : ''}` : 'quiet',
      rangeStart: start,
      rangeEnd: end,
      ...hit,
    });
  }

  // SPECIALS — recurring / deals (event_type === 'special'), all lit together
  const specialEvents = live.filter(isSpecial);
  const specialIds = [...new Set(specialEvents.map((e) => e.venue_id as string))];
  const specials: WindowChip[] = specialIds.length
    ? [{
        id: 'specials-all',
        window: 'specials',
        kicker: '★',
        primary: 'Weekly',
        sub: 'recurring',
        rangeStart: tonightNight,
        rangeEnd: tonightNight + 30 * DAY,
        litVenueIds: specialIds,
        eventCount: specialEvents.length,
      }]
    : [];

  return { tonight, week, month, specials };
}

/** Convenience: the soonest live event at a venue, for the floating toast. */
export function soonestEventLabel(beacon: BeaconState | undefined): string | null {
  if (!beacon?.soonest) return null;
  const d = new Date(beacon.soonest.start_time);
  return `${beacon.soonest.title} · ${MONTH[d.getMonth()]} ${d.getDate()}`;
}

/** Crowd × events: 0→1 heat factor from going_count, for beacon underglow
 *  intensity. Tune the ceiling per market; 250 RSVPs ≈ fully hot. */
export function heatFactor(beacon: BeaconState | undefined, ceiling = 250): number {
  if (!beacon) return 0;
  return Math.max(0, Math.min(1, beacon.topGoing / ceiling));
}
