/**
 * Demo builds (npm run dev:demo / build:demo, VITE_SOCIAL_THEME=suncruiser)
 * read local fixtures and keep RSVPs/posts in this browser. Every other
 * build reads and writes Supabase.
 */
export const SOCIAL_DEMO = import.meta.env.VITE_SOCIAL_THEME === 'suncruiser';

/** Where shared events point until event deep links exist (see report). */
export const SHARE_LINK = 'https://venuu.app';

// "New" markers: events created since this device's previous Social visit.
const VISIT_KEY = 'social-last-visit';
const NEW_WINDOW_MS = 3 * 86_400_000;   // first visit: the last 3 days count as new

/** Call once per Social arrival; returns the cutoff for "New". */
export function takeLastVisit(now: number = Date.now()): number {
  let prev: number | null = null;
  try {
    const v = localStorage.getItem(VISIT_KEY);
    prev = v ? Number(v) : null;
    localStorage.setItem(VISIT_KEY, String(now));
  } catch { /* not persisted */ }
  return prev ?? now - NEW_WINDOW_MS;
}
