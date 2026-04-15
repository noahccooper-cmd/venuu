import { CapacitorNfc } from '@capgo/capacitor-nfc';
import type { NfcEvent } from '@capgo/capacitor-nfc';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Device } from '@capacitor/device';
import { supabase } from './supabase';

export interface CheckinResult {
  success: boolean;
  visit_count?: number;
  error?: string;
  distance_meters?: number;
}

export type CheckinStatus = 'scanning' | 'detected' | 'verifying';

/**
 * Normalise a raw NFC tag UID to an uppercase hex string with no separators.
 * The plugin returns id as number[] (per type definitions), but we guard for
 * string form just in case.
 */
function normalizeTagUid(rawId: unknown): string {
  if (Array.isArray(rawId)) {
    return (rawId as number[])
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
  if (typeof rawId === 'string') {
    return rawId.replace(/[:\s-]/g, '').toUpperCase();
  }
  return String(rawId).toUpperCase();
}

export async function isNfcAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const result = await CapacitorNfc.isSupported();
    console.log('[nfc] isSupported:', result);
    return result.supported;
  } catch (e) {
    console.error('[nfc] isSupported threw:', e);
    return false;
  }
}

/**
 * Start the native NFC scan sheet and check the user in when a registered
 * tag is tapped.
 *
 * Session-type strategy
 * ─────────────────────
 * NFCTagReaderSession ('tag')  → reads ANY tag (blank, NDEF, raw MIFARE).
 *   Requires 'TAG' in com.apple.developer.nfc.readersession.formats
 *   entitlement AND that entitlement must be active in the provisioning
 *   profile (enabled in Apple Developer Portal → App ID capabilities).
 *
 * NFCNDEFReaderSession ('ndef') → reads NDEF-formatted tags only.
 *   Only requires NFCReaderUsageDescription in Info.plist — no special
 *   provisioning entitlement beyond NFC enabled.
 *
 * We try 'tag' first; if the native layer rejects (entitlement missing from
 * profile), we fall back to 'ndef'. This keeps working in both environments
 * while the provisioning profile is being updated.
 */
export async function startNfcCheckin(
  venueId: string,
  onStatusChange?: (status: CheckinStatus) => void,
): Promise<CheckinResult> {
  console.log('[nfc] === startNfcCheckin ===');
  console.log('[nfc] venue:', venueId);
  console.log('[nfc] platform:', Capacitor.getPlatform());
  console.log('[nfc] available methods:', Object.keys(CapacitorNfc as object));

  if (!Capacitor.isNativePlatform()) {
    console.log('[nfc] not native — bailing');
    return { success: false, error: 'not_native' };
  }

  // Auth check — reads from local session cache, no network or permission prompt
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.log('[nfc] no user signed in');
    return { success: false, error: 'not_signed_in' };
  }
  console.log('[nfc] user:', user.id);

  // Deferred-resolve pattern: we set up all listeners BEFORE calling
  // startScanning so that no tag event can fire into an empty listener set.
  let resolveCheckin!: (r: CheckinResult) => void;
  const checkinPromise = new Promise<CheckinResult>((res) => { resolveCheckin = res; });

  let settled = false;
  // Set synchronously at the very top of processTagEvent, before any await.
  // Swift always calls notify(event:) before session.invalidate(), so this
  // flag is true before nfcStateChange can fire after a successful tag read.
  let tagEventReceived = false;
  const listenerHandles: Array<{ remove: () => void }> = [];
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const settle = (result: CheckinResult) => {
    if (settled) return;
    settled = true;
    console.log('[nfc] settle:', result);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    CapacitorNfc.stopScanning().catch(() => {});
    listenerHandles.forEach((h) => h.remove());
    resolveCheckin(result);
  };

  const processTagEvent = async (event: NfcEvent) => {
    // Set SYNCHRONOUSLY before any await so nfcStateChange knows a tag was received
    tagEventReceived = true;
    console.log('[nfc] tag event:', JSON.stringify(event));
    if (settled) { console.log('[nfc] already settled — skip'); return; }

    const rawId = event?.tag?.id;
    console.log('[nfc] raw id:', rawId, 'type:', typeof rawId, 'isArray:', Array.isArray(rawId));
    const tagUid = normalizeTagUid(rawId);
    console.log('[nfc] normalised UID:', tagUid);

    if (!tagUid) {
      console.warn('[nfc] empty UID');
      settle({ success: false, error: 'tag_not_registered' });
      return;
    }

    onStatusChange?.('detected');

    console.log('[nfc] looking up tag in DB...');
    const { data: tag, error: tagError } = await supabase
      .from('nfc_tags')
      .select('venue_id, is_active')
      .eq('tag_uid', tagUid)
      .maybeSingle();

    console.log('[nfc] DB result:', { tag, tagError, tagUid });

    if (tagError) {
      console.error('[nfc] DB error:', tagError.message);
      settle({ success: false, error: 'tag_lookup_failed' });
      return;
    }
    if (!tag) {
      console.warn('[nfc] UID not registered:', tagUid);
      settle({ success: false, error: 'tag_not_registered' });
      return;
    }
    if (!tag.is_active) {
      console.warn('[nfc] tag disabled');
      settle({ success: false, error: 'tag_disabled' });
      return;
    }
    if (tag.venue_id !== venueId) {
      console.warn('[nfc] wrong venue — tag.venue_id:', tag.venue_id, 'expected:', venueId);
      settle({ success: false, error: 'wrong_venue_tag' });
      return;
    }

    // Tag verified — NOW get GPS
    console.log('[nfc] tag verified — getting GPS');
    onStatusChange?.('verifying');

    let lat = 0;
    let lng = 0;
    try {
      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000,
      });
      lat = position.coords.latitude;
      lng = position.coords.longitude;
      console.log('[nfc] GPS:', lat, lng);
    } catch (geoErr: unknown) {
      const msg = geoErr instanceof Error ? geoErr.message : String(geoErr);
      console.error('[nfc] GPS error:', msg);
      settle({ success: false, error: 'location_denied' });
      return;
    }

    const deviceInfo = await Device.getId();

    console.log('[nfc] calling record_venue_checkin RPC');
    const { data, error } = await supabase.rpc('record_venue_checkin', {
      p_user_id: user.id,
      p_venue_id: venueId,
      p_source: 'nfc',
      p_user_lat: lat,
      p_user_lng: lng,
      p_device_id: deviceInfo.identifier,
    });

    console.log('[nfc] RPC result:', { data, error });

    if (error) {
      settle({ success: false, error: error.message });
      return;
    }

    settle(data as CheckinResult);
  };

  try {
    // ── STEP 1: Register all listeners BEFORE startScanning ─────────────────
    console.log('[nfc] registering listeners...');

    // nfcEvent = catch-all for every tag type
    const h0 = await CapacitorNfc.addListener('nfcEvent', processTagEvent);
    listenerHandles.push(h0);
    console.log('[nfc] nfcEvent listener ready');

    const h1 = await CapacitorNfc.addListener('tagDiscovered', processTagEvent);
    listenerHandles.push(h1);
    console.log('[nfc] tagDiscovered listener ready');

    const h2 = await CapacitorNfc.addListener('ndefDiscovered', processTagEvent);
    listenerHandles.push(h2);
    console.log('[nfc] ndefDiscovered listener ready');

    // nfcStateChange fires from didInvalidateWithError in Swift whenever the
    // NFC session ends for ANY reason except:
    //   TAG session:  user-cancel
    //   NDEF session: successful first-NDEF-tag-read (invalidateAfterFirstRead)
    //
    // Two valid cases where it fires AFTER a tag is already being processed:
    //   • invalidateAfterFirstRead: true → session invalidated right after tag
    //     notify() fires first (before session.invalidate()), so tagEventReceived
    //     is already true by the time this handler runs.
    //
    // If tagEventReceived is still false when this fires, the session ended
    // before any tag was read — almost always the TAG entitlement missing from
    // the provisioning profile causing immediate invalidation after begin().
    const h3 = await CapacitorNfc.addListener(
      'nfcStateChange' as Parameters<typeof CapacitorNfc.addListener>[0],
      (event) => {
        console.log('[nfc] nfcStateChange:', JSON.stringify(event));
        if (!settled && !tagEventReceived) {
          console.error(
            '[nfc] session ended before any tag was read.\n' +
            '[nfc] Most likely cause: TAG entitlement missing from provisioning profile.\n' +
            '[nfc] Fix: Apple Developer Portal → App ID → enable "NFC Tag Reading" →\n' +
            '[nfc]       regenerate provisioning profile → Xcode clean build.',
          );
          settle({ success: false, error: 'scan_failed' });
        }
      },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listenerHandles.push(h3 as any);
    console.log('[nfc] nfcStateChange listener ready');

    // ── STEP 2: Start scanning — triggers the iOS native NFC sheet ───────────
    //
    // We try NFCTagReaderSession first (reads blank + NDEF + raw tags).
    // If the provisioning profile doesn't include the TAG entitlement,
    // the native layer rejects immediately — we catch that and fall back to
    // NFCNDEFReaderSession (needs only NFCReaderUsageDescription, works for
    // all NDEF-formatted tags).
    onStatusChange?.('scanning');

    let sessionTypeUsed: 'tag' | 'ndef' = 'tag';

    console.log('[nfc] attempting NFCTagReaderSession (iosSessionType: tag)...');
    try {
      await CapacitorNfc.startScanning({
        iosSessionType: 'tag',
        alertMessage: 'Hold your phone near the venuu tag',
        invalidateAfterFirstRead: true,
      });
      console.log('[nfc] NFCTagReaderSession started — iOS sheet should be visible');
    } catch (tagErr: unknown) {
      const tagMsg = tagErr instanceof Error ? tagErr.message : String(tagErr);
      console.warn('[nfc] NFCTagReaderSession rejected:', tagMsg);
      console.warn('[nfc] This usually means the TAG entitlement is missing from the');
      console.warn('[nfc] provisioning profile. Enable "NFC Tag Reading" on the App ID');
      console.warn('[nfc] in Apple Developer Portal, regenerate the profile, and rebuild.');
      console.warn('[nfc] Falling back to NFCNDEFReaderSession...');

      sessionTypeUsed = 'ndef';
      await CapacitorNfc.startScanning({
        iosSessionType: 'ndef',
        alertMessage: 'Hold your phone near the venuu tag',
        invalidateAfterFirstRead: true,
      });
      console.log('[nfc] NFCNDEFReaderSession started — iOS sheet should be visible');
      console.log('[nfc] NOTE: blank (non-NDEF) tags will NOT be detected in ndef mode.');
    }

    console.log('[nfc] session type in use:', sessionTypeUsed);

    // 30-second hard timeout
    timeoutId = setTimeout(() => {
      console.log('[nfc] 30s timeout — no tag read');
      settle({ success: false, error: 'scan_timeout' });
    }, 30000);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[nfc] startScanning threw (both sessions failed):', msg);
    listenerHandles.forEach((h) => h.remove());
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    resolveCheckin({ success: false, error: msg || 'scan_failed' });
  }

  return checkinPromise;
}
