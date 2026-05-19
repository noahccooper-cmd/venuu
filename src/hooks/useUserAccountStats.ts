import { useCallback, useEffect, useState } from 'react';
import { supabase, envReady } from '../lib/supabase';

/**
 * useUserAccountStats — pulls the consolidated counters off the
 * `user_account_stats` view added in migration 00029, and subscribes
 * to the underlying tables so the hero numbers stay live.
 *
 * Level is computed client-side from nightsOut so the view stays
 * simple + cheap. Thresholds mirror what the hero UI tier-pills.
 */

export type UserLevel =
  | 'newcomer'
  | 'regular'
  | 'local'
  | 'local-legend'
  | 'hall-of-fame';

export interface UserAccountStats {
  nightsOut: number;
  venuesDiscovered: number;
  totalRecaps: number;
  tasteAccuracyPct: number;
  totalPlans: number;
  plansCompleted: number;
  totalRewards: number;
  /** Distinct loyalty bars (drives "My Rewards" section subtitle).
   *  Decoupled from venues_discovered: rewards is an active opt-in
   *  per bar (NFC tap), discovered is anywhere the user has been. */
  loyaltyBarsCount: number;
  level: UserLevel;
  /** Consecutive weekends (Fri/Sat/Sun) with at least one
   *  user_visit, cover_purchase, or saved night_plan, counted
   *  backwards from the most recent weekend that hasn't passed yet. */
  weekendStreak: number;
  /** Earliest user_visits.first_seen_at (falls back to profile
   *  created_at). ISO timestamp. Drives the "since {Mon YYYY}"
   *  sublabel under the Nights Out stat. */
  accountSince: string | null;
  loading: boolean;
}

/** Public return shape of useUserAccountStats. `refetch` lives here
 *  rather than on UserAccountStats so the data shape stays pure. */
export interface UseUserAccountStatsResult extends UserAccountStats {
  /** Force a refresh of every counter — used by ProfileScreen on
   *  the venuu-plan-completed-celebrate event since night_plans
   *  realtime can lag a few hundred ms behind the dispatch. */
  refetch: () => Promise<void>;
}

const EMPTY: Omit<UserAccountStats, 'loading'> = {
  nightsOut: 0,
  venuesDiscovered: 0,
  totalRecaps: 0,
  tasteAccuracyPct: 0,
  totalPlans: 0,
  plansCompleted: 0,
  totalRewards: 0,
  loyaltyBarsCount: 0,
  level: 'newcomer',
  weekendStreak: 0,
  accountSince: null,
};

function computeLevel(nightsOut: number): UserLevel {
  if (nightsOut >= 100) return 'hall-of-fame';
  if (nightsOut >= 30)  return 'local-legend';
  if (nightsOut >= 15)  return 'local';
  if (nightsOut >= 5)   return 'regular';
  return 'newcomer';
}

/** YYYY-MM-DD in the device's local timezone (matching how
 *  loyalty_visits.night_of and cover_purchases.purchased_at land). */
function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Most recent Friday at-or-before today, in the local timezone.
 *  The streak walks weekend-by-weekend starting here. */
function lastFriday(now: Date): Date {
  const out = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // getDay(): Sun=0 Mon=1 … Fri=5 Sat=6.
  const dow = out.getDay();
  // Days to subtract to reach the most recent Friday (today if Fri).
  // Sun(0)→2, Mon(1)→3, Tue(2)→4, Wed(3)→5, Thu(4)→6, Fri(5)→0, Sat(6)→1
  const delta = (dow - 5 + 7) % 7;
  out.setDate(out.getDate() - delta);
  return out;
}

/** Given an unordered Set of active dates (YYYY-MM-DD), count how many
 *  consecutive weekends — walking backwards from the most recent —
 *  contain at least one active day (Fri OR Sat OR Sun). */
function computeWeekendStreak(activeDates: Set<string>, now: Date): number {
  let streak = 0;
  const cursor = lastFriday(now);
  // Hard ceiling: 5 years × 52 weekends so we never spin forever.
  for (let i = 0; i < 260; i++) {
    const fri = new Date(cursor); // already a Friday
    const sat = new Date(cursor); sat.setDate(sat.getDate() + 1);
    const sun = new Date(cursor); sun.setDate(sun.getDate() + 2);
    const has = activeDates.has(dateKey(fri))
             || activeDates.has(dateKey(sat))
             || activeDates.has(dateKey(sun));
    if (!has) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 7);
  }
  return streak;
}

interface UseUserAccountStatsArgs {
  /** profiles.id — required to fetch the row from the stats view. */
  profileId: string | null;
  /** profiles.auth_id — used to scope realtime subscriptions on
   *  loyalty_visits / cover_purchases / loyalty_redemptions, all
   *  of which key on auth.users.id (not profiles.id). */
  authId: string | null;
  /** profile.created_at — fallback for accountSince when the user
   *  has zero user_visits rows yet. */
  profileCreatedAt?: string | null;
}

export function useUserAccountStats({
  profileId,
  authId,
  profileCreatedAt,
}: UseUserAccountStatsArgs): UseUserAccountStatsResult {
  const [stats, setStats] = useState<Omit<UserAccountStats, 'loading'>>(EMPTY);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!envReady || !profileId) {
      setLoading(false);
      return;
    }

    // Pull the aggregate counters AND raw dates for the weekend
    // streak in parallel. The streak can't go in the view because
    // it depends on the current calendar week. The streak now reads
    // from user_visits (the new source of truth) so passive visits
    // count toward the streak even without an NFC tap.
    const [viewRes, visitDatesRes, firstVisitRes, coverDatesRes, planDatesRes, stopRatingsRes] = await Promise.all([
      supabase
        .from('user_account_stats')
        .select('*')
        .eq('profile_id', profileId)
        .maybeSingle(),
      supabase
        .from('user_visits')
        .select('night_of')
        .eq('user_id', profileId)
        .order('night_of', { ascending: false })
        .limit(500),
      // Earliest first_seen_at — drives the "since {Mon YYYY}" sublabel
      // under the Nights Out stat. Falls back to profileCreatedAt.
      supabase
        .from('user_visits')
        .select('first_seen_at')
        .eq('user_id', profileId)
        .order('first_seen_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      authId
        ? supabase
            .from('cover_purchases')
            .select('purchased_at')
            .eq('user_id', authId)
            .in('status', ['completed', 'used'])
            .order('purchased_at', { ascending: false })
            .limit(500)
        : Promise.resolve({ data: null, error: null } as const),
      supabase
        .from('night_plans')
        .select('created_at')
        .eq('user_id', profileId)
        .order('created_at', { ascending: false })
        .limit(500),
      // Stop ratings drive the Taste % stat: (loved + fine*0.5) / total
      // expressed as a percentage. Reads the raw rows so the formula
      // can evolve without a view migration.
      supabase
        .from('stop_ratings')
        .select('rating')
        .eq('user_id', profileId),
    ]);

    if (viewRes.error || !viewRes.data) {
      if (viewRes.error) console.warn('[user_account_stats] fetch failed:', viewRes.error.message);
      setStats(EMPTY);
      setLoading(false);
      return;
    }
    const data = viewRes.data;

    // Build the active-dates Set from all three sources.
    const active = new Set<string>();
    const visits = (visitDatesRes.data ?? []) as Array<{ night_of: string }>;
    for (const v of visits) {
      if (typeof v.night_of === 'string' && v.night_of) active.add(v.night_of.slice(0, 10));
    }
    const covers = (coverDatesRes.data ?? []) as Array<{ purchased_at: string }>;
    for (const c of covers) {
      if (typeof c.purchased_at === 'string' && c.purchased_at) {
        active.add(c.purchased_at.slice(0, 10));
      }
    }
    const planRows = (planDatesRes.data ?? []) as Array<{ created_at: string }>;
    for (const p of planRows) {
      if (typeof p.created_at === 'string' && p.created_at) {
        active.add(p.created_at.slice(0, 10));
      }
    }
    const weekendStreak = computeWeekendStreak(active, new Date());

    // accountSince — earliest user_visits.first_seen_at if present,
    // else fall back to the profile's created_at so the sublabel
    // still has something meaningful for users who haven't been
    // detected anywhere yet.
    const earliestFirstSeen = (firstVisitRes.data as { first_seen_at?: string | null } | null)?.first_seen_at ?? null;
    const accountSince: string | null = earliestFirstSeen ?? profileCreatedAt ?? null;

    // Taste accuracy — (loved + fine * 0.5) / total * 100. Falls
    // back to the view's value (zero today) when there are no
    // stop_ratings rows yet.
    const ratingRows = (stopRatingsRes.data ?? []) as Array<{ rating: 'loved' | 'fine' | 'meh' }>;
    let tasteAccuracy = (data.taste_accuracy_pct ?? 0) as number;
    if (ratingRows.length > 0) {
      const loved = ratingRows.filter(r => r.rating === 'loved').length;
      const fine  = ratingRows.filter(r => r.rating === 'fine').length;
      tasteAccuracy = Math.round(((loved + fine * 0.5) / ratingRows.length) * 100);
    }

    setStats({
      nightsOut:        (data.nights_out ?? 0) as number,
      venuesDiscovered: (data.venues_discovered ?? 0) as number,
      totalRecaps:      (data.total_recaps ?? 0) as number,
      tasteAccuracyPct: tasteAccuracy,
      totalPlans:       (data.total_plans ?? 0) as number,
      plansCompleted:   (data.plans_completed ?? 0) as number,
      totalRewards:     (data.total_rewards ?? 0) as number,
      loyaltyBarsCount: (data.loyalty_bars_count ?? 0) as number,
      level:            computeLevel((data.nights_out ?? 0) as number),
      weekendStreak,
      accountSince,
    });
    setLoading(false);
  }, [profileId, authId, profileCreatedAt]);

  // ── Initial fetch + refetch on identity change ──
  useEffect(() => {
    setLoading(true);
    refetch();
  }, [refetch]);

  // ── Realtime — whenever any contributing table records a change for
  // this user, re-run the aggregate query. The view itself isn't
  // realtime-able, so we listen on the source tables instead.
  useEffect(() => {
    if (!envReady || !authId) return;

    const channel = supabase
      .channel(`user_stats_rt:${authId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'loyalty_visits', filter: `user_id=eq.${authId}` },
        () => { void refetch(); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cover_purchases', filter: `user_id=eq.${authId}` },
        () => { void refetch(); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'loyalty_redemptions', filter: `user_id=eq.${authId}` },
        () => { void refetch(); },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [authId, refetch]);

  // night_plans + user_visits + venue_recaps key on profile.id /
  // username respectively. user_visits is the most active table now
  // (proximity detector writes to it) — subscribing makes Nights Out
  // and Venues Discovered counters update LIVE as visits land.
  useEffect(() => {
    if (!envReady || !profileId) return;
    const channel = supabase
      .channel(`user_stats_profile_rt:${profileId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'night_plans', filter: `user_id=eq.${profileId}` },
        () => { void refetch(); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_visits', filter: `user_id=eq.${profileId}` },
        () => { void refetch(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profileId, refetch]);

  // Listen for the rate-night dopamine event — when a user finishes
  // the rating flow PlanSheet dispatches venuu-night-rated. Refetch
  // immediately so the Taste % stat ticks up before the realtime
  // sub fires (which can lag ~200ms).
  useEffect(() => {
    function handle() { void refetch(); }
    window.addEventListener('venuu-night-rated', handle as EventListener);
    return () => window.removeEventListener('venuu-night-rated', handle as EventListener);
  }, [refetch]);

  // venue_recaps is keyed on username (denormalized — no FK), so
  // realtime filter has to be by username. The channel rebuilds when
  // username changes (rare).
  // NOTE: we read `stats.username` indirectly via the view; the hook
  // doesn't keep username in state, so we skip a filter and re-fetch
  // on any recap change is acceptable cost — recaps are low-volume.
  useEffect(() => {
    if (!envReady || !profileId) return;
    const channel = supabase
      .channel(`user_stats_recaps_rt:${profileId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'venue_recaps' },
        () => { void refetch(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profileId, refetch]);

  return { ...stats, loading, refetch };
}
