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

export interface SocialGroup { key: string; label: string; events: SocialEvent[] }

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Partner lists: Today / Tomorrow / "Thu, Oct 2" for the coming week,
 *  then one header per month further out. Events must be sorted. */
export function groupSocialDays(events: SocialEvent[], now: number = Date.now()): SocialGroup[] {
  const today = dayStart(now);
  // Via dayStart so a DST change can't shift "tomorrow" by an hour.
  const tomorrow = dayStart(today + DAY + 6 * 3_600_000);
  const groups: SocialGroup[] = [];
  const byKey = new Map<string, SocialGroup>();
  for (const ev of events) {
    const start = new Date(ev.start_time).getTime();
    const day = start <= now ? today : dayStart(start);
    const d = new Date(day);
    let key: string;
    let label: string;
    if (day === today) { key = 'today'; label = 'Today'; }
    else if (day === tomorrow) { key = 'tomorrow'; label = 'Tomorrow'; }
    else if (day < today + 7 * DAY) {
      key = `day-${day}`;
      label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    } else {
      key = `month-${d.getFullYear()}-${d.getMonth()}`;
      label = MONTH_NAMES[d.getMonth()];
    }
    let g = byKey.get(key);
    if (!g) { g = { key, label, events: [] }; byKey.set(key, g); groups.push(g); }
    g.events.push(ev);
  }
  return groups;
}

/** City lists: the three fixed sections, empty ones dropped. */
export function sectionGroups(events: SocialEvent[], now: number = Date.now()): SocialGroup[] {
  const g = groupSocialEvents(events, now);
  return (['today', 'this_week', 'upcoming'] as const)
    .filter(s => g[s].length > 0)
    .map(s => ({ key: s, label: SOCIAL_SECTION_LABELS[s], events: g[s] }));
}
