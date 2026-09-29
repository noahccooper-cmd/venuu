import { Geolocation } from '@capacitor/geolocation';

/**
 * The user's location for Social, asked for at most once. A remembered
 * denial means we never prompt again; a remembered grant re-reads the
 * position silently. Any failure → null (callers fall back).
 */
const ASKED_KEY = 'social-location-answer';
let cached: [number, number] | null = null;

function answer(): string | null {
  try { return localStorage.getItem(ASKED_KEY); } catch { return null; }
}
function remember(v: 'granted' | 'denied'): void {
  try { localStorage.setItem(ASKED_KEY, v); } catch { /* not persisted */ }
}

export async function getSocialLocation(): Promise<[number, number] | null> {
  if (cached) return cached;
  if (answer() === 'denied') return null;
  try {
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 6000, maximumAge: 300_000 });
    cached = [pos.coords.longitude, pos.coords.latitude];
    remember('granted');
    return cached;
  } catch (e) {
    // Only an actual permission denial is remembered; timeouts may retry.
    const msg = String((e as { message?: string })?.message ?? '');
    if ((e as { code?: number })?.code === 1 || /denied|permission/i.test(msg)) remember('denied');
    return null;
  }
}
