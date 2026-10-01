import { useCallback, useEffect, useState } from 'react';
import { supabase, envReady } from '../lib/supabase';

/**
 * useVenuuRank — the user's standing off `user_venuu_rank` plus their
 * movement off `user_rank_movement` (the stock-market delta vs the
 * last snapshot). `delta` > 0 means they climbed (rank number dropped).
 */
export interface VenuuRank {
  rank: number | null;
  totalRanked: number;
  score: number;
  topPercentile: number;
  delta: number | null;
  excluded: boolean;
  loading: boolean;
}

export interface UseVenuuRankResult extends VenuuRank {
  refetch: () => Promise<void>;
}

export function useVenuuRank(profileId: string | null): UseVenuuRankResult {
  const [state, setState] = useState<Omit<VenuuRank, 'loading'>>({
    rank: null, totalRanked: 0, score: 0, topPercentile: 0, delta: null, excluded: false,
  });
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!envReady || !profileId) { setLoading(false); return; }

    const [meRes, totalRes, mvRes] = await Promise.all([
      supabase.from('user_venuu_rank')
        .select('global_rank, total_ranked, venuu_score, top_percentile')
        .eq('profile_id', profileId).maybeSingle(),
      supabase.from('user_venuu_rank')
        .select('profile_id', { count: 'exact', head: true }),
      // user_rank_movement may not exist until the movement SQL is run —
      // a failed query just yields null delta, which the UI handles.
      supabase.from('user_rank_movement')
        .select('delta').eq('profile_id', profileId).maybeSingle(),
    ]);

    const total = totalRes.count ?? (meRes.data?.total_ranked as number | undefined) ?? 0;
    const delta = (mvRes.data?.delta ?? null) as number | null;

    if (meRes.data) {
      setState({
        rank: (meRes.data.global_rank as number),
        totalRanked: (meRes.data.total_ranked as number) ?? total,
        score: (meRes.data.venuu_score as number) ?? 0,
        topPercentile: (meRes.data.top_percentile as number) ?? 0,
        delta,
        excluded: false,
      });
    } else {
      setState({ rank: null, totalRanked: total, score: 0, topPercentile: 0, delta: null, excluded: true });
    }
    setLoading(false);
  }, [profileId]);

  useEffect(() => { setLoading(true); void refetch(); }, [refetch]);

  useEffect(() => {
    if (!envReady || !profileId) return;
    const ch = supabase
      .channel(`venuu_rank_rt:${profileId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_visits', filter: `user_id=eq.${profileId}` }, () => { void refetch(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [profileId, refetch]);

  return { ...state, loading, refetch };
}
