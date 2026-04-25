import { useState, useEffect, useCallback } from 'react';
import { supabase, envReady } from '../lib/supabase';
import { getTonightDate } from '../lib/utils';

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
    recordExternalCheckIn,
    redeem,
  };
}
