/** Shared event time formatting utilities.
 *  Used in: map labels, Drop pinned cards, venue card event section. */

/** Format hour: "10PM", "10:30PM" (no minutes if on the hour). */
function fmtHour(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

/** Is the given date the same calendar day as today (using 4am rollover)? */
function isSameNight(d: Date, now: Date): boolean {
  // Normalize both to "nightlife day" — before 4am counts as previous day
  const normalize = (dt: Date) => {
    const n = new Date(dt);
    if (n.getHours() < 4) n.setDate(n.getDate() - 1);
    return `${n.getFullYear()}-${n.getMonth()}-${n.getDate()}`;
  };
  return normalize(d) === normalize(now);
}

/** Is the given date tomorrow night? */
function isTomorrowNight(d: Date, now: Date): boolean {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return isSameNight(d, tomorrow);
}

/**
 * Format event start time as a loud, readable label.
 * - "TONIGHT AT 10PM"
 * - "TOMORROW AT 9PM"
 * - "FRI MAR 28 AT 10PM"
 */
export function formatEventTime(startTime: string): string {
  const d = new Date(startTime);
  const now = new Date();
  const hour = fmtHour(d);

  if (isSameNight(d, now)) {
    return `TONIGHT AT ${hour}`;
  }
  if (isTomorrowNight(d, now)) {
    return `TOMORROW AT ${hour}`;
  }
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
  return `${day} AT ${hour}`;
}

/**
 * Is the event happening right now?
 * True if current time is between startTime and expiresAt.
 */
export function isHappeningNow(startTime: string, expiresAt: string): boolean {
  const now = Date.now();
  return now >= new Date(startTime).getTime() && now < new Date(expiresAt).getTime();
}

/**
 * Combined label: returns "HAPPENING NOW" if active, or the formatted time.
 */
export function getEventTimeLabel(startTime: string, expiresAt: string): { text: string; isNow: boolean } {
  if (isHappeningNow(startTime, expiresAt)) {
    return { text: 'HAPPENING NOW', isNow: true };
  }
  return { text: formatEventTime(startTime), isNow: false };
}
