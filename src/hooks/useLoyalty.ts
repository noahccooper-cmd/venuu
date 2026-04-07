import { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { supabase, envReady } from '../lib/supabase';
import { generateNightlyCode, getTonightDate } from '../lib/nightlyCode';

const CHECK_IN_RADIUS_M = 200;

/** Haversine distance in meters */
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Get current GPS position (native or web) */
async function getCurrentPosition(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  try {
    if (Capacitor.isNativePlatform()) {
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
    }
    return await new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000 },
      );
    });
  } catch {
    return null;
  }
}

export interface LoyaltyState {
  visitCount: number;
  effectiveVisits: number;
  visitsRequired: number;
  rewardText: string | null;
  rewardDescription: string | null;
  hasCheckedInTonight: boolean;
  canRedeem: boolean;
  redemptionsCount: number;
  loading: boolean;
  checkIn: (code: string, venueLat: number, venueLng: number) => Promise<{ success: boolean; error?: string }>;
  checkInWithGeofence: (distance: number, isNearVenue: boolean) => Promise<{ success: boolean; error?: string }>;
  checkInWithGPS: (venueLat: number, venueLng: number) => Promise<{ success: boolean; error?: string }>;
  recordExternalCheckIn: () => void;
  redeem: () => Promise<{ success: boolean }>;
}

export function useLoyalty(venueId: string | null, userId: string | null): LoyaltyState {
  const [visitCount, setVisitCount] = useState(0);
  const [visitsRequired, setVisitsRequired] = useState(5);
  const [rewardText, setRewardText] = useState<string | null>(null);
  const [rewardDescription, setRewardDescription] = useState<string | null>(null);
  const [hasCheckedInTonight, setHasCheckedInTonight] = useState(false);
  const [redemptionsCount, setRedemptionsCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Fetch loyalty state when venue/user changes
  useEffect(() => {
    if (!envReady || !venueId || !userId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const nightOf = getTonightDate();

    Promise.all([
      // Total visits at this venue
      supabase
        .from('loyalty_visits')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('venue_id', venueId),
      // Already checked in tonight?
      supabase
        .from('loyalty_visits')
        .select('id')
        .eq('user_id', userId)
        .eq('venue_id', venueId)
        .eq('night_of', nightOf)
        .maybeSingle(),
      // Venue reward config
      supabase
        .from('venue_rewards')
        .select('reward_text, visits_required, reward_description')
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .maybeSingle(),
      // Total redemptions at this venue
      supabase
        .from('loyalty_redemptions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('venue_id', venueId),
    ]).then(([visitsRes, tonightRes, rewardRes, redemptionsRes]) => {
      const totalVisits = visitsRes.count ?? 0;
      const totalRedemptions = redemptionsRes.count ?? 0;
      const required = rewardRes.data?.visits_required ?? 5;

      setVisitCount(totalVisits);
      setRedemptionsCount(totalRedemptions);
      setHasCheckedInTonight(!!tonightRes.data);
      if (rewardRes.data) {
        setRewardText(rewardRes.data.reward_text);
        setVisitsRequired(required);
        setRewardDescription(rewardRes.data.reward_description ?? null);
      }
      setLoading(false);
    });
  }, [venueId, userId]);

  // Realtime: bounce reward config changes from the bouncer portal instantly
  useEffect(() => {
    if (!envReady || !venueId) return;

    const channel = supabase
      .channel(`venue_rewards_rt:${venueId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'venue_rewards', filter: `venue_id=eq.${venueId}` },
        (payload) => {
          const row = payload.new as { reward_text?: string; visits_required?: number; reward_description?: string | null; is_active?: boolean } | null;
          if (!row || row.is_active === false) return;
          if (row.reward_text !== undefined) setRewardText(row.reward_text);
          if (row.visits_required !== undefined) setVisitsRequired(row.visits_required);
          if ('reward_description' in row) setRewardDescription(row.reward_description ?? null);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [venueId]);

  const effectiveVisits = visitCount - (redemptionsCount * visitsRequired);
  const canRedeem = effectiveVisits >= visitsRequired;

  const checkIn = useCallback(async (code: string, venueLat: number, venueLng: number): Promise<{ success: boolean; error?: string }> => {
    if (!venueId || !userId) {
      return { success: false, error: 'Sign in to check in' };
    }

    const nightOf = getTonightDate();
    const correctCode = generateNightlyCode(venueId, nightOf);

    if (code !== correctCode) {
      return { success: false, error: 'Wrong code. Check the sign at the bar.' };
    }

    // GPS verification — MUST be within 200m of venue
    const pos = await getCurrentPosition();
    if (!pos) {
      return { success: false, error: 'Location access required to check in. Please enable GPS.' };
    }
    if (pos.accuracy > 100) {
      return { success: false, error: 'GPS signal too weak. Move to an open area and try again.' };
    }
    const dist = haversine(pos.lat, pos.lng, venueLat, venueLng);
    console.log('CODE CHECKIN GPS:', { userLat: pos.lat, userLng: pos.lng, venueLat, venueLng, distance: Math.round(dist), accuracy: pos.accuracy });
    if (dist > CHECK_IN_RADIUS_M) {
      return { success: false, error: 'You must be at the venue to check in' };
    }

    // Insert loyalty visit
    const { error } = await supabase.from('loyalty_visits').insert({
      user_id: userId,
      venue_id: venueId,
      code_entered: code,
      night_of: nightOf,
      verified_at: new Date().toISOString(),
    });

    if (error) {
      if (error.code === '23505') {
        setHasCheckedInTonight(true);
        return { success: false, error: 'Already checked in tonight!' };
      }
      return { success: false, error: 'Something went wrong. Try again.' };
    }

    setVisitCount(prev => prev + 1);
    setHasCheckedInTonight(true);
    return { success: true };
  }, [venueId, userId]);

  const checkInWithGeofence = useCallback(async (distance: number, isNearVenue: boolean): Promise<{ success: boolean; error?: string }> => {
    console.log('GEO CHECKIN ATTEMPT:', { userId, venueId, distance, isNearVenue });

    // FIRST: reject unless geofence hook confirms nearness
    if (!isNearVenue) {
      return { success: false, error: 'Not at venue. Location check failed.' };
    }

    if (!venueId || !userId) {
      return { success: false, error: 'Sign in to check in' };
    }

    // Double-check: reject if distance exceeds geofence radius
    if (typeof distance !== 'number' || distance > 200) {
      return { success: false, error: 'Too far from venue. Use the code instead.' };
    }

    const nightOf = getTonightDate();

    const { error } = await supabase.from('loyalty_visits').insert({
      user_id: userId,
      venue_id: venueId,
      code_entered: 'GEO',
      night_of: nightOf,
      verified_at: new Date().toISOString(),
    });

    if (error) {
      if (error.code === '23505') {
        setHasCheckedInTonight(true);
        return { success: false, error: 'Already checked in tonight!' };
      }
      return { success: false, error: 'Something went wrong. Try again.' };
    }

    setVisitCount(prev => prev + 1);
    setHasCheckedInTonight(true);
    return { success: true };
  }, [venueId, userId]);

  /** GPS proximity check-in — for launch before NFC tags are deployed. */
  const checkInWithGPS = useCallback(async (venueLat: number, venueLng: number): Promise<{ success: boolean; error?: string }> => {
    if (!venueId || !userId) return { success: false, error: 'Sign in to check in' };

    const pos = await getCurrentPosition();
    if (!pos) return { success: false, error: 'Enable location to check in' };
    if (pos.accuracy > 100) return { success: false, error: 'GPS signal too weak. Move outside and try again.' };

    const dist = haversine(pos.lat, pos.lng, venueLat, venueLng);
    if (dist > 100) return { success: false, error: `Get closer to check in (${Math.round(dist)}m away)` };

    const nightOf = getTonightDate();
    const { error } = await supabase.from('loyalty_visits').insert({
      user_id: userId,
      venue_id: venueId,
      code_entered: 'GPS',
      night_of: nightOf,
    });

    if (error) {
      if (error.code === '23505') return { success: false, error: 'Already checked in tonight!' };
      return { success: false, error: 'Check-in failed. Try again.' };
    }

    setVisitCount(prev => prev + 1);
    setHasCheckedInTonight(true);
    return { success: true };
  }, [venueId, userId]);

  /** Sync local state after an external check-in (e.g. from useNFC). */
  const recordExternalCheckIn = useCallback(() => {
    setVisitCount(prev => prev + 1);
    setHasCheckedInTonight(true);
  }, []);

  const redeem = useCallback(async (): Promise<{ success: boolean }> => {
    if (!venueId || !userId) return { success: false };

    const { error } = await supabase.from('loyalty_redemptions').insert({
      user_id: userId,
      venue_id: venueId,
      verified_by_staff: false,
    });

    if (error) return { success: false };

    setRedemptionsCount(prev => prev + 1);
    return { success: true };
  }, [venueId, userId]);

  return {
    visitCount,
    effectiveVisits,
    visitsRequired,
    rewardText,
    rewardDescription,
    hasCheckedInTonight,
    canRedeem,
    redemptionsCount,
    loading,
    checkIn,
    checkInWithGeofence,
    checkInWithGPS,
    recordExternalCheckIn,
    redeem,
  };
}
