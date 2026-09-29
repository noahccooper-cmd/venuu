import { formatEventTime } from './eventUtils';
import type { SocialEvent } from './socialTypes';

export type SocialSection = 'today' | 'this_week' | 'upcoming';

export const SOCIAL_SECTION_LABELS: Record<SocialSection, string> = {
  today: 'Today',
  this_week: 'This Week',
  upcoming: 'Upcoming',
};

const DAY = 86_400_000;
// Same 4am rollover as eventUtils.formatEventTime, so a 1am set still
// reads as "today" and matches its TONIGHT label.
const ROLLOVER_HOUR = 4;

function dayStart(epoch: number): number {
  const d = new Date(epoch);
  if (d.getHours() < ROLLOVER_HOUR) d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function sectionFor(ev: SocialEvent, now: number = Date.now()): SocialSection {
  const start = new Date(ev.start_time).getTime();
  const today = dayStart(now);
  const day = dayStart(start);
  if (start <= now || day === today) return 'today';
  if (day < today + 7 * DAY) return 'this_week';
  return 'upcoming';
}

/** Events already sorted by start_time → grouped, empty groups kept. */
export function groupSocialEvents(events: SocialEvent[], now: number = Date.now()): Record<SocialSection, SocialEvent[]> {
  const out: Record<SocialSection, SocialEvent[]> = { today: [], this_week: [], upcoming: [] };
  for (const ev of events) out[sectionFor(ev, now)].push(ev);
  return out;
}

/** "8 this week" — events starting within the next 7 days (or underway). */
export function countThisWeek(events: SocialEvent[], now: number = Date.now()): number {
  const horizon = dayStart(now) + 7 * DAY;
  return events.filter(e => new Date(e.start_time).getTime() < horizon).length;
}

/** Card time line: today → "11:00 PM"; any other day → "Thu · 6:30 PM". */
export function socialCardTime(ev: SocialEvent, now: number = Date.now()): string {
  const start = new Date(ev.start_time);
  const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (dayStart(start.getTime()) === dayStart(now)) return time;
  const dow = start.toLocaleDateString('en-US', { weekday: 'short' });
  return `${dow} · ${time}`;
}

/** Card time label. Reuses eventUtils.formatEventTime; its "TONIGHT" is
 *  nightlife wording, so a daytime start today reads "TODAY" instead. */
export function socialTimeLabel(ev: SocialEvent, now: number = Date.now()): string {
  const label = formatEventTime(ev.start_time);
  const start = new Date(ev.start_time);
  if (label.startsWith('TONIGHT') && start.getHours() >= ROLLOVER_HOUR && start.getHours() < 17
      && dayStart(start.getTime()) === dayStart(now)) {
    return label.replace('TONIGHT', 'TODAY');
  }
  return label;
}
