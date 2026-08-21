import { useCallback, useEffect, useState } from 'react';
import { supabase, envReady } from '../lib/supabase';

export interface VenueBoardRow {
  profileId: string;
  username: string;
  displayName: string | null;
  avatarColor: string | null;
  visitCount: number;
  distinctNights: number;
  venueScore: number;
  venueRank: number;
}

interface UseVenueBoardResult {
  rows: VenueBoardRow[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

interface VenueBoardViewRow {
  profile_id: string;
  username: string;
  display_name: string | null;
  avatar_color: string | null;
  visit_count: number;
  distinct_nights: number;
  venue_score: number;
  venue_rank: number;
}

/** Full ranked visitor list for one venue — the tap-into-a-bar drill-down. */
export function useVenueBoard(venueId: string | null): UseVenueBoardResult {
  const [rows, setRows] = useState<VenueBoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const doFetch = useCallback(async () => {
    if (!envReady || !venueId) { setLoading(false); return; }

    const { data, error: err } = await supabase
      .from('venue_leaderboard')
      .select('profile_id,username,display_name,avatar_color,visit_count,distinct_nights,venue_score,venue_rank')
      .eq('venue_id', venueId)
      .order('venue_rank', { ascending: true })
      .limit(50);

    if (err) {
      console.warn('[useVenueBoard] fetch failed:', err.message);
      setError(new Error(err.message));
      setLoading(false);
      return;
    }

    setRows(((data as VenueBoardViewRow[]) ?? []).map(r => ({
      profileId: r.profile_id,
      username: r.username,
      displayName: r.display_name,
      avatarColor: r.avatar_color,
      visitCount: r.visit_count,
      distinctNights: r.distinct_nights,
      venueScore: r.venue_score,
      venueRank: r.venue_rank,
    })));
    setError(null);
    setLoading(false);
  }, [venueId]);

  useEffect(() => {
    setLoading(true);
    doFetch();
  }, [doFetch]);

  useEffect(() => {
    if (!envReady || !venueId) return;
    const channel = supabase
      .channel(`venue-board-rt:${venueId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_visits', filter: `venue_id=eq.${venueId}` }, () => { void doFetch(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [venueId, doFetch]);

  return { rows, loading, error, refetch: doFetch };
}
