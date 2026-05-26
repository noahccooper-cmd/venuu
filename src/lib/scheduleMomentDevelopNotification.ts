/**
 * Schedule a local notification on the device for the moment's
 * 8am develop time. The phone's own scheduler fires it at the
 * right time even if the app is closed / device is offline /
 * server is down.
 *
 * Fire-and-forget: any error logs but doesn't surface to user.
 * Permission denial just means no notification — capture flow
 * still works perfectly.
 *
 * The notification ID is deterministic per recap (numeric hash
 * of recapId so it fits the int32 range LocalNotifications
 * requires) — this means re-scheduling for the same recap
 * replaces rather than duplicates.
 */

import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { pickMomentDevelopCopy } from './momentNotificationCopy';

/**
 * Convert a UUID string to a stable int32 by hashing. iOS notification
 * IDs must fit in int32. We use a simple djb2 hash, then mask to
 * positive int32 range.
 */
function uuidToIntId(uuid: string): number {
  let hash = 5381;
  for (let i = 0; i < uuid.length; i++) {
    hash = ((hash << 5) + hash) + uuid.charCodeAt(i);
    hash = hash | 0; // force int32
  }
  // Keep positive — Capacitor LocalNotifications rejects negatives
  return Math.abs(hash);
}

export interface ScheduleMomentNotificationOptions {
  recapId: string;
  venueName: string;
  venueId: string;
  momentNumber: number;
  developedAt: string;  // ISO timestamp from venue_recaps.developed_at
}

export async function scheduleMomentDevelopNotification(
  opts: ScheduleMomentNotificationOptions
): Promise<void> {
  const { recapId, venueName, venueId, momentNumber, developedAt } = opts;

  console.log('[notif] scheduling develop reveal for', venueName, 'at', developedAt);

  // Web fallback — local notifications only work on native
  if (!Capacitor.isNativePlatform()) {
    console.log('[notif] web platform — skipping schedule');
    return;
  }

  try {
    // Check / request permission. If denied, log and exit gracefully.
    const permState = await LocalNotifications.checkPermissions();
    if (permState.display !== 'granted') {
      const req = await LocalNotifications.requestPermissions();
      if (req.display !== 'granted') {
        console.log('[notif] permission denied — no scheduling');
        return;
      }
    }

    // Parse the develop time. If somehow in the past, don't schedule
    // (the notification would fire immediately, which would be
    // confusing right after capture).
    const fireDate = new Date(developedAt);
    if (Number.isNaN(fireDate.getTime())) {
      console.warn('[notif] invalid developedAt:', developedAt);
      return;
    }
    if (fireDate.getTime() <= Date.now() + 5_000) {
      console.warn('[notif] develop time already passed, not scheduling');
      return;
    }

    const copy = pickMomentDevelopCopy(venueName, momentNumber);
    const notifId = uuidToIntId(recapId);

    // extra data deep-links the tap to the user's profile + the
    // specific recap (future enhancement could scroll to that orb)
    await LocalNotifications.schedule({
      notifications: [
        {
          id: notifId,
          title: copy.title,
          body: copy.body,
          schedule: { at: fireDate },
          sound: 'default',
          extra: {
            recapId,
            venueId,
            venueName,
            momentNumber,
            kind: 'moment_develop',
          },
        },
      ],
    });

    console.log('[notif] scheduled, id:', notifId, 'fires at:', fireDate.toISOString());
  } catch (err: any) {
    console.warn('[notif] schedule failed:', err?.message || err);
    // Fire-and-forget: don't bubble up. Capture flow continues.
  }
}
