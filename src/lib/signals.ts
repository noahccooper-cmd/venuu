/**
 * Prediction-engine signal helper.
 *
 * Fire-and-forget wrapper around the record_signal RPC. Never throws into
 * caller code — signal-write failures are silent so they can never break a
 * user-facing flow.
 *
 * Two emission paths:
 *  • Normal: supabase.rpc('record_signal'). Use when there is no immediate
 *    navigation pressure (in-app interactions like card_view, geofence
 *    enter, plan_intent, etc.).
 *  • beforeNavigation=true: keepalive fetch with sendBeacon fallback.
 *    Use when the caller is about to do something that suspends the
 *    webview (e.g. `window.location.href = 'maps://...'` on iOS). The OS
 *    guarantees keepalive requests dispatch even after page unload.
 */

import { supabase } from './supabase';

export type SignalType =
  | 'app_open_in_geofence'
  | 'background_presence'
  | 'direction_request'
  | 'plan_intent'
  | 'card_view'
  | 'nfc_tap'
  | 'loyalty_visit'
  | 'cover_purchase'
  | 'recap_post';

export interface RecordSignalParams {
  venueId: string;
  signalType: SignalType;
  signalValue?: number;
  sourceTable?: string | null;
  sourceRowId?: string | null;
  metadata?: Record<string, unknown> | null;
  // When true, use keepalive fetch (with sendBeacon fallback) so the
  // request survives webview suspension from an imminent deep-link.
  beforeNavigation?: boolean;
}

interface RpcPayload {
  p_venue_id: string;
  p_user_id: string | null;
  p_signal_type: SignalType;
  p_signal_value: number;
  p_source_table: string | null;
  p_source_row_id: string | null;
  p_metadata: Record<string, unknown> | null;
}

async function buildPayload(params: RecordSignalParams): Promise<RpcPayload> {
  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    /* anon or auth failed — proceed with null user */
  }
  return {
    p_venue_id: params.venueId,
    p_user_id: userId,
    p_signal_type: params.signalType,
    p_signal_value: params.signalValue ?? 1.0,
    p_source_table: params.sourceTable ?? null,
    p_source_row_id: params.sourceRowId ?? null,
    p_metadata: params.metadata ?? null,
  };
}

/** Fallback to sendBeacon when keepalive fetch isn't available. Beacon
 *  can't set custom headers, so the anon key is shoved into the query
 *  string. PostgREST accepts `?apikey=...` for unauthenticated calls. */
function fireViaBeacon(payload: RpcPayload): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
    return false;
  }
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anonKey) return false;

  try {
    const url = `${supabaseUrl}/rest/v1/rpc/record_signal?apikey=${encodeURIComponent(anonKey)}`;
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    return navigator.sendBeacon(url, blob);
  } catch {
    return false;
  }
}

/** Preferred path for navigation-imminent calls. `keepalive: true` tells
 *  the OS to dispatch the request even after the page unloads. iOS
 *  Capacitor webview honors this flag. */
async function fireViaKeepalive(payload: RpcPayload): Promise<boolean> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anonKey) return false;

  let accessToken: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    accessToken = data.session?.access_token ?? null;
  } catch {
    /* anon — fine */
  }

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/record_signal`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': `Bearer ${accessToken ?? anonKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[signals] keepalive POST non-OK', res.status, text);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[signals] keepalive POST threw', err);
    return false;
  }
}

/**
 * Fire a prediction-engine signal. Non-blocking, never throws.
 * Caller does not await — the signal write happens in the background.
 */
export function recordSignal(params: RecordSignalParams): void {
  void recordSignalAsync(params);
}

async function recordSignalAsync(params: RecordSignalParams): Promise<void> {
  if (params.beforeNavigation) {
    const payload = await buildPayload(params);
    const ok = await fireViaKeepalive(payload);
    if (!ok) {
      const beaconOk = fireViaBeacon(payload);
      if (!beaconOk) {
        console.warn('[signals] both keepalive and beacon paths failed', params.signalType);
      }
    }
    return;
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.rpc('record_signal', {
      p_venue_id: params.venueId,
      p_user_id: user?.id ?? null,
      p_signal_type: params.signalType,
      p_signal_value: params.signalValue ?? 1.0,
      p_source_table: params.sourceTable ?? null,
      p_source_row_id: params.sourceRowId ?? null,
      p_metadata: params.metadata ?? null,
    });
    if (error) {
      console.warn('[signals] record_signal failed:', params.signalType, error.message);
    }
  } catch (err) {
    console.warn('[signals] record_signal threw:', err);
  }
}
