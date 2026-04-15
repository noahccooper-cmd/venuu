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

function parseNdefTextPayload(event: NfcEvent): string | null {
  try {
    console.log('[nfc] parsing NDEF — full event:', JSON.stringify(event));

    // Try multiple possible shapes since plugin types are loose
    const tag = event?.tag as Record<string, unknown> | undefined;
    if (!tag) {
      console.warn('[nfc] no tag in event');
      return null;
    }
    console.log('[nfc] tag keys:', Object.keys(tag));

    // Try ndefMessage first (most common), then records, then messages
    let records: unknown[] | undefined;
    if (Array.isArray(tag.ndefMessage)) records = tag.ndefMessage as unknown[];
    else if (Array.isArray(tag.records)) records = tag.records as unknown[];
    else if (Array.isArray(tag.messages)) records = tag.messages as unknown[];

    if (!records || records.length === 0) {
      console.warn('[nfc] no NDEF records found in tag');
      return null;
    }
    console.log('[nfc] found', records.length, 'NDEF records');

    // Look at the first record
    const firstRecord = records[0] as Record<string, unknown>;
    console.log('[nfc] first record keys:', Object.keys(firstRecord));

    // Try multiple payload field names
    const rawPayload = firstRecord.payload ?? firstRecord.data ?? firstRecord.value;
    if (!rawPayload) {
      console.warn('[nfc] first record has no payload field');
      return null;
    }

    // Convert payload to Uint8Array regardless of input shape
    let bytes: Uint8Array;
    if (rawPayload instanceof Uint8Array) {
      bytes = rawPayload;
    } else if (Array.isArray(rawPayload)) {
      bytes = new Uint8Array(rawPayload as number[]);
    } else if (typeof rawPayload === 'string') {
      // Some plugins return base64-encoded payloads
      try {
        const binary = atob(rawPayload as string);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      } catch {
        // If not base64, assume it's already the text content directly
        console.log('[nfc] payload is plain string, returning as-is');
        return (rawPayload as string).trim() || null;
      }
    } else {
      console.warn('[nfc] unknown payload type:', typeof rawPayload);
      return null;
    }

    console.log('[nfc] payload bytes length:', bytes.length);
    if (bytes.length < 2) {
      console.warn('[nfc] payload too short');
      return null;
    }

    // Parse NDEF text record: byte 0 is status, lower 6 bits = lang code length
    const statusByte = bytes[0];
    const langLen = statusByte & 0x3F;
    console.log('[nfc] status byte:', statusByte.toString(16), 'langLen:', langLen);

    if (1 + langLen > bytes.length) {
      console.warn('[nfc] langLen overruns payload');
      return null;
    }

    const textBytes = bytes.slice(1 + langLen);
    const text = new TextDecoder('utf-8').decode(textBytes).trim();

    if (!text) {
      console.warn('[nfc] decoded text is empty');
      return null;
    }

    // Mask the password in the log
    const masked = text.length > 6
      ? `${text.slice(0, 3)}...${text.slice(-3)} (len ${text.length})`
      : `*** (len ${text.length})`;
    console.log('[nfc] parsed password:', masked);

    return text;
  } catch (err) {
    console.error('[nfc] parseNdefTextPayload threw:', err);
    return null;
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

    const password = parseNdefTextPayload(event);
    if (!password) {
      console.warn('[nfc] failed to parse password from tag');
      settle({ success: false, error: 'tag_not_registered' });
      return;
    }

    onStatusChange?.('detected');

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

    console.log('[nfc] calling record_venue_checkin RPC with password');
    const { data, error } = await supabase.rpc('record_venue_checkin', {
      p_user_id: user.id,
      p_venue_id: venueId,
      p_source: 'nfc',
      p_user_lat: lat,
      p_user_lng: lng,
      p_device_id: deviceInfo.identifier,
      p_nfc_password: password,
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
        const evt = event as { status?: string; enabled?: boolean };
        console.log('[nfc] nfcStateChange:', JSON.stringify(event));

        // NFC_OK + enabled means "session is alive and ready" — NOT a failure
        const isHealthyStartup = evt?.status === 'NFC_OK' && evt?.enabled === true;
        if (isHealthyStartup) {
          console.log('[nfc] session is alive and ready — waiting for tag');
          return;
        }

        // Any non-healthy state before a tag was received = failure
        if (!settled && !tagEventReceived) {
          console.error(
            '[nfc] session ended before any tag was read. status:',
            evt?.status,
            'enabled:',
            evt?.enabled,
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
