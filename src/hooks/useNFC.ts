import { useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase, envReady } from '../lib/supabase';
import { getTonightDate } from '../lib/nightlyCode';

export interface NFCCheckInResult {
  success: boolean;
  message: string;
  venueId?: string;
  venueName?: string;
  alreadyCheckedIn?: boolean;
  loyaltyInactive?: boolean;
  visitCount?: number;
  rewardEarned?: boolean;
}

type NFCScanCallback = (result: NFCCheckInResult) => void;

/** Parse a venue ID from an NFC tag payload (URL or raw text). */
function parseVenueId(payload: string): string | null {
  const trimmed = payload.trim();
  // URL format: https://venuu.app/checkin/{venue_id}
  const urlMatch = trimmed.match(/venuu\.app\/checkin\/([a-f0-9-]+)/i);
  if (urlMatch) return urlMatch[1];
  // UUID format directly
  const uuidMatch = trimmed.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
  if (uuidMatch) return uuidMatch[0];
  return null;
}

/**
 * NFC check-in hook for venue loyalty.
 * Handles tag reading, venue lookup, duplicate detection, and loyalty_visits insert.
 */
export function useNFC(userId: string | null) {
  const [isNFCAvailable, setIsNFCAvailable] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const callbackRef = useRef<NFCScanCallback | null>(null);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nfcPluginRef = useRef<any>(null);

  // Check NFC availability on mount
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    import('@capgo/capacitor-nfc').then((mod) => {
      nfcPluginRef.current = mod.CapacitorNfc;
      mod.CapacitorNfc.isSupported().then((result: { supported: boolean }) => {
        setIsNFCAvailable(result.supported);
      }).catch(() => {
        setIsNFCAvailable(false);
      });
    }).catch(() => {
      setIsNFCAvailable(false);
    });
  }, []);

  /** Process a scanned NFC tag payload — look up venue, validate, insert visit. */
  const processTag = useCallback(async (payload: string): Promise<NFCCheckInResult> => {
    if (!userId || !envReady) {
      return { success: false, message: 'Sign in to check in' };
    }

    const venueId = parseVenueId(payload);
    if (!venueId) {
      return { success: false, message: 'Invalid tag — not a venuu card' };
    }

    // Look up venue
    const { data: venue, error: venueErr } = await supabase
      .from('venues')
      .select('id, name, loyalty_active')
      .eq('id', venueId)
      .maybeSingle();

    if (venueErr || !venue) {
      return { success: false, message: 'Venue not found' };
    }

    // Check loyalty active
    if (!venue.loyalty_active) {
      return {
        success: false,
        message: `Loyalty isn't active at ${venue.name} right now`,
        venueName: venue.name,
        venueId: venue.id,
        loyaltyInactive: true,
      };
    }

    // Check already checked in tonight
    const nightOf = getTonightDate();
    const { data: existing } = await supabase
      .from('loyalty_visits')
      .select('id')
      .eq('user_id', userId)
      .eq('venue_id', venueId)
      .eq('night_of', nightOf)
      .maybeSingle();

    if (existing) {
      return {
        success: false,
        message: `Already checked in at ${venue.name} tonight!`,
        venueName: venue.name,
        venueId: venue.id,
        alreadyCheckedIn: true,
      };
    }

    // Insert loyalty visit
    const { error: insertErr } = await supabase.from('loyalty_visits').insert({
      user_id: userId,
      venue_id: venueId,
      code_entered: 'NFC',
      night_of: nightOf,
    });

    if (insertErr) {
      // Duplicate constraint
      if (insertErr.code === '23505') {
        return {
          success: false,
          message: `Already checked in at ${venue.name} tonight!`,
          venueName: venue.name,
          venueId: venue.id,
          alreadyCheckedIn: true,
        };
      }
      return { success: false, message: 'Check-in failed. Try again.' };
    }

    // Count total visits
    const { count } = await supabase
      .from('loyalty_visits')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('venue_id', venueId);

    const visitCount = count ?? 1;

    // Check if reward earned
    const { data: reward } = await supabase
      .from('venue_rewards')
      .select('visits_required')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .maybeSingle();

    const rewardEarned = reward ? (visitCount % reward.visits_required === 0) : false;

    return {
      success: true,
      message: `Checked in at ${venue.name}!`,
      venueName: venue.name,
      venueId: venue.id,
      visitCount,
      rewardEarned,
    };
  }, [userId]);

  /** Start scanning for NFC tags. Calls onResult when a tag is read. */
  const startNFCScan = useCallback((onResult: NFCScanCallback) => {
    callbackRef.current = onResult;
    setIsScanning(true);

    // 30-second timeout
    scanTimeoutRef.current = setTimeout(() => {
      stopNFCScan();
      onResult({ success: false, message: "Couldn't find a tag. Try again." });
    }, 30000);

    if (!Capacitor.isNativePlatform() || !nfcPluginRef.current) {
      // Web fallback: can't scan NFC
      return;
    }

    const Nfc = nfcPluginRef.current;
    // Listen for NDEF-discovered tags (contains URL or text records)
    Nfc.addListener('ndefDiscovered', async (event: { tag?: { ndefMessage?: Array<{ payload: number[] }> } }) => {
      const records = event.tag?.ndefMessage ?? [];
      let payload = '';

      // Decode first record's payload bytes to string
      for (const rec of records) {
        if (rec.payload && rec.payload.length > 0) {
          // Skip first byte (status byte for text records) and decode
          const bytes = rec.payload.length > 1 ? rec.payload.slice(1) : rec.payload;
          payload = String.fromCharCode(...bytes);
          break;
        }
      }

      if (!payload) {
        callbackRef.current?.({ success: false, message: 'Empty NFC tag' });
        return;
      }

      // Vibrate on scan
      if (navigator.vibrate) navigator.vibrate(50);

      const result = await processTag(payload);
      callbackRef.current?.(result);

      // Auto-stop on successful scan
      if (result.success || result.alreadyCheckedIn || result.loyaltyInactive) {
        stopNFCScan();
      }
    });

    Nfc.startScanning().catch(() => {
      // Silently fail — session might already be active
    });
  }, [processTag]);

  /** Stop NFC scanning session. */
  const stopNFCScan = useCallback(() => {
    setIsScanning(false);
    callbackRef.current = null;
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
    if (Capacitor.isNativePlatform() && nfcPluginRef.current) {
      nfcPluginRef.current.stopScanning().catch(() => {});
      nfcPluginRef.current.removeAllListeners();
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
      if (Capacitor.isNativePlatform() && nfcPluginRef.current) {
        nfcPluginRef.current.stopScanning().catch(() => {});
        nfcPluginRef.current.removeAllListeners();
      }
    };
  }, []);

  return { isNFCAvailable, isScanning, startNFCScan, stopNFCScan };
}
