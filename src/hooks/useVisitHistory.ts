import { useState, useEffect } from 'react';
import { supabase, envReady } from '../lib/supabase';

export interface VenueVisitSummary {
  venueId: string;
  venueName: string;
  venueCity: string;
  visitCount: number;
  visitsRequired: number;
  rewardText: string | null;
  canRedeem: boolean;
}

export interface VisitHistoryData {
  totalVisits: number;
  uniqueVenues: number;
  totalRewards: number;
  bars: VenueVisitSummary[];
  loading: boolean;
}

export function useVisitHistory(userId: string | null): VisitHistoryData {
  const [bars, setBars] = useState<VenueVisitSummary[]>([]);
  const [totalVisits, setTotalVisits] = useState(0);
  const [totalRewards, setTotalRewards] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!envReady || !userId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const fetchHistory = async () => {
      // Get all loyalty visits for this user with venue names and cities
      const { data: visitRows, error: visitErr } = await supabase
        .from('loyalty_visits')
        .select('venue_id, venues(name, city)')
        .eq('user_id', userId);

      if (visitErr || !visitRows) {
        setLoading(false);
        return;
      }

      setTotalVisits(visitRows.length);

      // Group visits by venue
      const venueMap = new Map<string, { name: string; city: string; count: number }>();
      for (const row of visitRows as unknown as { venue_id: string; venues: { name: string; city: string } | null }[]) {
        const existing = venueMap.get(row.venue_id);
        if (existing) {
          existing.count++;
        } else {
          venueMap.set(row.venue_id, {
            name: row.venues?.name ?? 'Unknown',
            city: row.venues?.city ?? '',
            count: 1,
          });
        }
      }

      if (venueMap.size === 0) {
        setBars([]);
        setTotalRewards(0);
        setLoading(false);
        return;
      }

      // Get rewards config for each venue
      const venueIds = [...venueMap.keys()];
      const { data: rewards } = await supabase
        .from('venue_rewards')
        .select('venue_id, reward_text, visits_required')
        .eq('is_active', true)
        .in('venue_id', venueIds);

      // Get redemption counts
      const { data: redemptions } = await supabase
        .from('loyalty_redemptions')
        .select('venue_id')
        .eq('user_id', userId);

      const allRedemptions = redemptions ?? [];
      setTotalRewards(allRedemptions.length);

      const redemptionCounts = new Map<string, number>();
      for (const r of allRedemptions) {
        redemptionCounts.set(r.venue_id, (redemptionCounts.get(r.venue_id) ?? 0) + 1);
      }

      const rewardMap = new Map(
        (rewards ?? []).map(r => [r.venue_id, { text: r.reward_text, required: r.visits_required }])
      );

      // Build summaries sorted by most visits first
      const summaries: VenueVisitSummary[] = [...venueMap.entries()]
        .map(([venueId, { name, city, count }]) => {
          const reward = rewardMap.get(venueId);
          const required = reward?.required ?? 5;
          const redeemed = redemptionCounts.get(venueId) ?? 0;
          const effective = count - (redeemed * required);
          return {
            venueId,
            venueName: name,
            venueCity: city,
            visitCount: count,
            visitsRequired: required,
            rewardText: reward?.text ?? null,
            canRedeem: effective >= required,
          };
        })
        .sort((a, b) => b.visitCount - a.visitCount);

      setBars(summaries);
      setLoading(false);
    };

    fetchHistory();
  }, [userId]);

  return { totalVisits, uniqueVenues: bars.length, totalRewards, bars, loading };
}
