import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

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
