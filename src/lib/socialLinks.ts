import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import type { SocialEvent } from './socialTypes';
import { SHARE_LINK } from './socialMode';

/** External links open in the in-app browser sheet (Capacitor Browser);
 *  on web the plugin falls back to a new tab, and we guard that too. */
export async function openExternal(url: string): Promise<void> {
  try {
    await Browser.open({ url });
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

/** Apple Maps directions to a point. Native: the Maps app via maps://;
 *  web: maps.apple.com in a new tab. */
export function openAppleMapsDirections(lat: number, lng: number, label: string): void {
  const q = encodeURIComponent(label);
  if (Capacitor.isNativePlatform()) {
    window.location.href = `maps://?daddr=${lat},${lng}&q=${q}`;
    return;
  }
  window.open(`https://maps.apple.com/?daddr=${lat},${lng}&q=${q}`, '_blank', 'noopener');
}

/** Native share sheet (Capacitor Share); on web, navigator.share, then the
 *  clipboard. Returns 'copied' when it fell back to copying. */
export async function shareText(title: string, text: string, url?: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title, text, url, dialogTitle: title });
      return 'shared';
    }
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return 'shared';
    }
    await navigator.clipboard.writeText(url ? `${text}\n${url}` : text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export function openEmail(address: string): void {
  window.location.href = `mailto:${address}`;
}

/** Share an event: title, date, place and a link. No event deep links
 *  exist yet, so the link is the Venuu site (see SHARE_LINK). */
export function shareEvent(ev: SocialEvent): Promise<'shared' | 'copied' | 'failed'> {
  const when = ev.date_tba
    ? 'Date TBA'
    : new Date(ev.start_time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const place = ev.external_venue_name ?? ev.address;
  return shareText(ev.title, `${ev.title} · ${when} · ${place} — on Venuu`, SHARE_LINK);
}
