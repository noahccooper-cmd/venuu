import type { SocialEvent } from './socialTypes';

/**
 * Host-mode DEMO store — events a host "posts" live only in this browser's
 * localStorage and merge with the fixtures. No Supabase. Every read/write
 * is guarded: storage can be unavailable (private mode, cleared data).
 */
const KEY = 'social-demo-events';
const CHANGED = 'venuu:social-demo-events';

export const HOST_DEMO_ENABLED = import.meta.env.VITE_SOCIAL_HOST_DEMO === 'true';

export function loadDemoEvents(): SocialEvent[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SocialEvent[]) : [];
  } catch {
    return [];
  }
}

function write(events: SocialEvent[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(events));
  } catch {
    /* storage unavailable — the post simply won't persist */
  }
  window.dispatchEvent(new CustomEvent(CHANGED));
}

export function addDemoEvents(events: SocialEvent[]): void {
  write([...loadDemoEvents(), ...events]);
}

export function resetDemoEvents(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
  window.dispatchEvent(new CustomEvent(CHANGED));
}

export function subscribeDemoEvents(cb: () => void): () => void {
  window.addEventListener(CHANGED, cb);
  return () => window.removeEventListener(CHANGED, cb);
}
