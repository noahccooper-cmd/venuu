import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, envReady } from '../lib/supabase';

export interface CommunityLeaderboardRow {
  profileId: string;
  username: string;
  displayName: string | null;
  avatarColor: string | null;
  venuuScore: number;
  /** Sequential 1,2,3… position within this Knoxville-filtered result
   *  set — matches what's visibly on the board. This is the rank to
   *  display; globalRank below has gaps (e.g. #1 Knoxville could be
   *  global #47) since it's a slice of the unpartitioned global view. */
  localRank: number;
  globalRank: number;
  delta: number | null;
}

interface UseCommunityLeaderboardResult {
  rows: CommunityLeaderboardRow[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

interface RankViewRow {
  profile_id: string;
  username: string;
  display_name: string | null;
  avatar_color: string | null;
  venuu_score: number;
  global_rank: number;
}

interface MovementRow {
  profile_id: string;
  delta: number | null;
}

/** Coalesce realtime bursts into one re-fetch every 30 s — this is a
 *  city-wide board with no single-user filter, so it'd otherwise
 *  refetch on every visit from anyone in the city. */
const REFETCH_DEBOUNCE_MS = 30_000;

/**
 * Top-N Knoxville users off user_venuu_rank, with movement deltas
 * merged in from user_rank_movement. Ranks shown are GLOBAL — the
 * view has no per-city partition — so this is "the top Knoxville
 * users, ranked on the global board," not a Knoxville-only rank scale.
 */
export function useCommunityLeaderboard(limit = 10): UseCommunityLeaderboardResult {
  const [rows, setRows] = useState<CommunityLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const aliveRef = useRef(true);
  const lastFetchAtRef = useRef(0);
  const pendingTimerRef = useRef<number | null>(null);

  const doFetch = useCallback(async () => {
    if (!envReady) { setLoading(false); return; }
    lastFetchAtRef.current = Date.now();

    const { data: rankData, error: rankErr } = await supabase
      .from('user_venuu_rank')
      .select('profile_id,username,display_name,avatar_color,venuu_score,global_rank')
      .eq('home_city', 'knoxville')
      .order('global_rank', { ascending: true })
      .limit(limit);

    if (!aliveRef.current) return;

    if (rankErr) {
      console.warn('[useCommunityLeaderboard] fetch failed:', rankErr.message);
      setError(new Error(rankErr.message));
      setLoading(false);
      return;
    }

    const rankRows = (rankData as RankViewRow[]) ?? [];
    const profileIds = rankRows.map(r => r.profile_id);

    const { data: mvData } = profileIds.length
      ? await supabase
          .from('user_rank_movement')
          .select('profile_id,delta')
          .in('profile_id', profileIds)
      : { data: [] as MovementRow[] };

    if (!aliveRef.current) return;

    const deltaByProfile = new Map<string, number | null>();
    for (const m of (mvData as MovementRow[]) ?? []) deltaByProfile.set(m.profile_id, m.delta);

    setRows(rankRows.map((r, i) => ({
      profileId: r.profile_id,
      username: r.username,
      displayName: r.display_name,
      avatarColor: r.avatar_color,
      venuuScore: r.venuu_score,
      localRank: i + 1,
      globalRank: r.global_rank,
      delta: deltaByProfile.get(r.profile_id) ?? null,
    })));
    setError(null);
    setLoading(false);
  }, [limit]);

  const requestRefetch = useCallback(() => {
    if (pendingTimerRef.current !== null) return;
    const elapsed = Date.now() - lastFetchAtRef.current;
    if (elapsed >= REFETCH_DEBOUNCE_MS) {
      doFetch();
    } else {
      pendingTimerRef.current = window.setTimeout(() => {
        pendingTimerRef.current = null;
        doFetch();
      }, REFETCH_DEBOUNCE_MS - elapsed);
    }
  }, [doFetch]);

  useEffect(() => {
    aliveRef.current = true;
    setLoading(true);
    lastFetchAtRef.current = 0;
    doFetch();
    return () => {
      aliveRef.current = false;
      if (pendingTimerRef.current !== null) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, [doFetch]);

  // Realtime — city-wide board, no single-user filter makes sense here.
  // Debounced like useCityAggregates so a burst of visits doesn't
  // hammer the view with re-fetches.
  useEffect(() => {
    if (!envReady) return;
    const channel = supabase
      .channel(`community-leaderboard-rt-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_visits' }, () => requestRefetch())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [requestRefetch]);

  return { rows, loading, error, refetch: doFetch };
}
