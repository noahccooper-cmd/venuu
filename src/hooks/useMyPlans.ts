import { useCallback, useEffect, useState } from 'react';
import { supabase, envReady } from '../lib/supabase';
import type { PlanStop } from '../components/Venny/PlanCard';

/**
 * useMyPlans — recent night_plans rows for the signed-in user.
 * Drives the "My Plans" carousel on the profile and is realtime-aware
 * so a save in Venny appears instantly on the profile.
 *
 * night_plans.user_id references profiles.id (NOT auth.users.id) per
 * migration 00028 — pass the *profile* id here.
 */

export type PlanStatus = 'planned' | 'active' | 'completed' | 'abandoned';

export interface MyPlan {
  id: string;
  title: string;
  summary: string | null;
  city: string;
  stops: PlanStop[];
  totalEstimatedCost: number | null;
  totalDurationMin: number | null;
  startTime: string | null;
  endTime: string | null;
  groupSize: number | null;
  vibeTags: string[];
  status: PlanStatus;
  createdAt: string;
  /** Set when the plan was marked completed via EndNightModal.
   *  Used by PlanMiniCard to render a "ran [date]" subtitle. */
  completedAt: string | null;
  conversationId: string | null;
  shareToken: string | null;
}

export interface UseMyPlansResult {
  plans: MyPlan[];
  loading: boolean;
  refetch: () => Promise<void>;
}

function normalizePlanRow(row: Record<string, unknown>): MyPlan {
  const stopsRaw = row.stops;
  const stops: PlanStop[] = Array.isArray(stopsRaw) ? (stopsRaw as PlanStop[]) : [];
  const vibeRaw = row.vibe_tags;
  const vibeTags: string[] = Array.isArray(vibeRaw)
    ? (vibeRaw.filter(v => typeof v === 'string') as string[])
    : [];
  return {
    id:                  row.id as string,
    title:               (row.title as string) ?? 'Untitled plan',
    summary:             (row.summary as string) ?? null,
    city:                (row.city as string) ?? '',
    stops,
    totalEstimatedCost:  typeof row.total_estimated_cost === 'number' ? row.total_estimated_cost : null,
    totalDurationMin:    typeof row.total_duration_min === 'number' ? row.total_duration_min : null,
    startTime:           (row.start_time as string) ?? null,
    endTime:             (row.end_time as string) ?? null,
    groupSize:           typeof row.group_size === 'number' ? row.group_size : null,
    vibeTags,
    status:              (row.status as PlanStatus) ?? 'planned',
    createdAt:           row.created_at as string,
    completedAt:         (row.completed_at as string) ?? null,
    conversationId:      (row.conversation_id as string) ?? null,
    shareToken:          (row.share_token as string) ?? null,
  };
}

export function useMyPlans(profileId: string | null): UseMyPlansResult {
  const [plans, setPlans] = useState<MyPlan[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!envReady || !profileId) {
      setPlans([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('night_plans')
      .select('id, title, summary, city, stops, total_estimated_cost, total_duration_min, start_time, end_time, group_size, vibe_tags, status, created_at, completed_at, conversation_id, share_token')
      .eq('user_id', profileId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) {
      console.warn('[my_plans] fetch failed:', error.message);
      setPlans([]);
      setLoading(false);
      return;
    }
    setPlans((data ?? []).map(r => normalizePlanRow(r as Record<string, unknown>)));
    setLoading(false);
  }, [profileId]);

  useEffect(() => {
    setLoading(true);
    refetch();
  }, [refetch]);

  // Realtime — saved plans appear instantly when Venny inserts.
  useEffect(() => {
    if (!envReady || !profileId) return;
    const channel = supabase
      .channel(`my_plans_rt:${profileId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'night_plans', filter: `user_id=eq.${profileId}` },
        () => { void refetch(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profileId, refetch]);

  // Backup refetch trigger — PlanSheet dispatches this event
  // when a plan is marked completed. The realtime sub above usually
  // covers it, but the listener is cheap insurance against flake.
  useEffect(() => {
    if (!profileId) return;
    const handler = () => { void refetch(); };
    window.addEventListener('venuu-plan-completed', handler as EventListener);
    return () => window.removeEventListener('venuu-plan-completed', handler as EventListener);
  }, [profileId, refetch]);

  return { plans, loading, refetch };
}
