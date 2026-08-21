import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, envReady } from '../lib/supabase';

const EXCLUDED_CATEGORIES = ['fraternity', 'frat', 'greek', 'sorority'];

/** Coalesce realtime bursts into one re-fetch every 30 s — city-wide
 *  board, no single-user filter, same reasoning as useCommunityLeaderboard. */
const REFETCH_DEBOUNCE_MS = 30_000;

export interface BarOwner {
  profileId: string;
  username: string;
  displayName: string | null;
  avatarColor: string | null;
  visitCount: number;
}

export interface BarOwnershipRow {
  venueId: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  owner: BarOwner | null;
}

interface UseBarOwnershipResult {
  bars: BarOwnershipRow[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

interface VenueRow {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  category: string | null;
}

interface OwnerRow {
  venue_id: string;
  profile_id: string;
  username: string;
  display_name: string | null;
  avatar_color: string | null;
  visit_count: number;
  venue_rank: number;
  first_claimed_at: string;
}

/**
 * The Knoxville bar wall — every active bar with its #1 venue_leaderboard
 * regular as "owner" (null if unclaimed). venue_leaderboard is PARTITION
 * BY venue_id, so venue_rank=1 is normally one row per venue — except on
 * an exact visit_count/score tie, where Postgres rank() gives 1 to every
 * tied row (confirmed live: LunaVerse has 3 users tied). On a tie, the
 * earliest claimant wins — first_claimed_at (MIN(user_visits.first_seen_at),
 * added in migration 00075) is deterministic and stable across requests,
 * unlike relying on whatever order Postgres/PostgREST returns ties in.
 */
export function useBarOwnership(): UseBarOwnershipResult {
  const [bars, setBars] = useState<BarOwnershipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const aliveRef = useRef(true);
  const lastFetchAtRef = useRef(0);
  const pendingTimerRef = useRef<number | null>(null);

  const doFetch = useCallback(async () => {
    if (!envReady) { setLoading(false); return; }
    lastFetchAtRef.current = Date.now();

    const { data: venueData, error: venueErr } = await supabase
      .from('venues')
      .select('id,name,slug,image_url,category')
      .eq('city', 'knoxville')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (!aliveRef.current) return;

    if (venueErr) {
      console.warn('[useBarOwnership] venues fetch failed:', venueErr.message);
      setError(new Error(venueErr.message));
      setLoading(false);
      return;
    }

    const venues = ((venueData as VenueRow[]) ?? [])
      .filter(v => !EXCLUDED_CATEGORIES.includes((v.category ?? '').toLowerCase()));
    const venueIds = venues.map(v => v.id);

    const { data: ownerData, error: ownerErr } = venueIds.length
      ? await supabase
          .from('venue_leaderboard')
          .select('venue_id,profile_id,username,display_name,avatar_color,visit_count,venue_rank,first_claimed_at')
          .in('venue_id', venueIds)
          .eq('venue_rank', 1)
      : { data: [] as OwnerRow[], error: null };

    if (!aliveRef.current) return;

    if (ownerErr) {
      console.warn('[useBarOwnership] owners fetch failed:', ownerErr.message);
      setError(new Error(ownerErr.message));
      setLoading(false);
      return;
    }

    // Group venue_rank=1 candidates by venue — usually exactly one,
    // occasionally tied (same venue_score). On a tie, earliest
    // first_claimed_at wins: deterministic, doesn't depend on
    // Postgres/PostgREST's unspecified order among equal ranks.
    const candidatesByVenue = new Map<string, OwnerRow[]>();
    for (const o of (ownerData as OwnerRow[]) ?? []) {
      const arr = candidatesByVenue.get(o.venue_id) ?? [];
      arr.push(o);
      candidatesByVenue.set(o.venue_id, arr);
    }

    const toBarOwner = (o: OwnerRow): BarOwner => ({
      profileId: o.profile_id,
      username: o.username,
      displayName: o.display_name,
      avatarColor: o.avatar_color,
      visitCount: o.visit_count,
    });

    const ownerByVenue = new Map<string, BarOwner>();
    for (const [venueId, candidates] of candidatesByVenue) {
      const winner = candidates.reduce((earliest, c) =>
        new Date(c.first_claimed_at).getTime() < new Date(earliest.first_claimed_at).getTime() ? c : earliest
      );
      ownerByVenue.set(venueId, toBarOwner(winner));
    }

    setBars(venues.map(v => ({
      venueId: v.id,
      name: v.name,
      slug: v.slug,
      imageUrl: v.image_url,
      owner: ownerByVenue.get(v.id) ?? null,
    })));
    setError(null);
    setLoading(false);
  }, []);

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

  useEffect(() => {
    if (!envReady) return;
    const channel = supabase
      .channel(`bar-ownership-rt-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_visits' }, () => requestRefetch())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [requestRefetch]);

  return { bars, loading, error, refetch: doFetch };
}
