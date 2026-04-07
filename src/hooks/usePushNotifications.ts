import { useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase, envReady } from '../lib/supabase';

export type PushStatus =
  | { stage: 'checking-platform' }
  | { stage: 'not-native'; reason: string }
  | { stage: 'requesting-permission' }
  | { stage: 'permission-denied' }
  | { stage: 'registering' }
  | { stage: 'token-saved' }
  | { stage: 'error'; message: string };

/**
 * Registers for push notifications on native iOS.
 * Saves the APNs token to Supabase push_tokens table.
 * Dispatches 'push-notification' custom events for in-app banner display.
 *
 * Only runs when: native platform + signed-in user + envReady.
 */
export function usePushNotifications(
  userId: string | null,
  city: string | null,
  onStatus?: (status: PushStatus) => void,
) {
  const registered = useRef(false);
  const statusCb = useCallback((s: PushStatus) => {
    console.debug('[push]', s.stage, 'stage' in s && 'message' in s ? (s as { message: string }).message : '');
    onStatus?.(s);
  }, [onStatus]);

  // Keep city in push_tokens up-to-date when user switches cities
  useEffect(() => {
    if (!userId || !city || !registered.current || !envReady) return;
    supabase
      .from('push_tokens')
      .update({ city, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .then(({ error }) => {
        if (error) console.error('[push] city update failed:', error.message);
        else console.debug('[push] city updated to', city);
      });
  }, [userId, city]);

  useEffect(() => {
    if (!userId || !envReady || registered.current) return;

    statusCb({ stage: 'checking-platform' });

    if (!Capacitor.isNativePlatform()) {
      statusCb({ stage: 'not-native', reason: 'web or simulator' });
      return;
    }

    const setup = async () => {
      try {
        // 1. Register ALL listeners BEFORE requesting permissions or registering.
        //    This prevents a race where APNs responds before the listener is attached.
        PushNotifications.addListener('registration', async (token) => {
          console.debug('[push] Got APNs token:', token.value.substring(0, 12) + '...');
          registered.current = true;

          // Upsert token to Supabase
          const { error: upsertError } = await supabase.from('push_tokens').upsert(
            {
              user_id: userId,
              token: token.value,
              platform: 'ios',
              city: city ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,token' }
          );

          if (upsertError) {
            console.error('[push] Token upsert failed:', upsertError.message);
            statusCb({ stage: 'error', message: `Token save failed: ${upsertError.message}` });
          } else {
            console.debug('[push] Token saved to push_tokens');
            statusCb({ stage: 'token-saved' });
          }
        });

        PushNotifications.addListener('registrationError', (err) => {
          console.error('[push] Registration error:', JSON.stringify(err));
          statusCb({ stage: 'error', message: `Registration failed: ${JSON.stringify(err)}` });
        });

        // Foreground notification — dispatch event for PushBanner
        PushNotifications.addListener('pushNotificationReceived', (notification) => {
          window.dispatchEvent(new CustomEvent('push-notification', {
            detail: {
              title: notification.title ?? '',
              body: notification.body ?? '',
              data: notification.data,
            },
          }));
        });

        // Notification tapped (background/killed) — could navigate in future
        PushNotifications.addListener('pushNotificationActionPerformed', (_action) => {
          // Future: navigate based on action.notification.data
        });

        // 2. Check current permission status.
        const permCheck = await PushNotifications.checkPermissions();
        console.debug('[push] Current permission:', permCheck.receive);

        let granted = permCheck.receive === 'granted';

        // If not yet determined (prompt not shown), request now.
        // This covers users who signed in without going through the onboarding
        // notification step (e.g. existing installs, re-installs).
        // iOS will only show the native prompt once; subsequent calls to
        // requestPermissions() when already denied return 'denied' silently.
        if (!granted && permCheck.receive !== 'denied') {
          statusCb({ stage: 'requesting-permission' });
          const permRequest = await PushNotifications.requestPermissions();
          console.debug('[push] Permission after request:', permRequest.receive);
          granted = permRequest.receive === 'granted';
        }

        if (!granted) {
          statusCb({ stage: 'permission-denied' });
          return;
        }

        // 3. Register with APNs (triggers the 'registration' listener above)
        statusCb({ stage: 'registering' });
        console.debug('[push] Calling PushNotifications.register()...');
        await PushNotifications.register();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[push] Setup error:', msg);
        statusCb({ stage: 'error', message: msg });
      }
    };

    setup();

    return () => {
      PushNotifications.removeAllListeners();
    };
  }, [userId, city, statusCb]);
}
