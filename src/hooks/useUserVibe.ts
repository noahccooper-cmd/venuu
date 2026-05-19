import { useEffect, useState } from 'react';
import { supabase, envReady } from '../lib/supabase';

/**
 * useUserVibe — surfaces the user_preferences row Venny has been
 * quietly filling in. Read-only in Ship 1; edit-from-profile arrives
 * in Ship 2. The Venny edge function continues to be the writer.
 *
 * IMPORTANT: user_preferences.user_id references auth.users.id —
 * NOT profiles.id. Pass authId from useAuth().user.id.
 */

export type BudgetTier = '$' | '$$' | '$$$';

export interface UserVibe {
  age: number | null;
  musicTaste: string | null;
  typicalBudget: BudgetTier | null;
  dressStyle: string | null;
  groupSizeTypical: number | null;
  vibesLiked: string[];
  vibesDisliked: string[];
  homeCity: string | null;
  hasAnyData: boolean;
  loading: boolean;
}

const EMPTY: Omit<UserVibe, 'loading'> = {
  age: null,
  musicTaste: null,
  typicalBudget: null,
  dressStyle: null,
  groupSizeTypical: null,
  vibesLiked: [],
  vibesDisliked: [],
  homeCity: null,
  hasAnyData: false,
};

function isBudgetTier(v: unknown): v is BudgetTier {
  return v === '$' || v === '$$' || v === '$$$';
}

export function useUserVibe(authId: string | null): UserVibe {
  const [vibe, setVibe] = useState<Omit<UserVibe, 'loading'>>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!envReady || !authId) {
      setVibe(EMPTY);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      const { data, error } = await supabase
        .from('user_preferences')
        .select('age, music_taste, typical_budget, dress_style, group_size_typical, vibes_liked, vibes_disliked, home_city')
        .eq('user_id', authId)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        if (error && error.code !== 'PGRST116') {
          // PGRST116 = "no rows" via .maybeSingle — expected for guests.
          console.warn('[user_vibe] fetch failed:', error.message);
        }
        setVibe(EMPTY);
        setLoading(false);
        return;
      }

      const liked  = Array.isArray(data.vibes_liked)    ? (data.vibes_liked    as string[]) : [];
      const disliked = Array.isArray(data.vibes_disliked) ? (data.vibes_disliked as string[]) : [];
      const next: Omit<UserVibe, 'loading'> = {
        age:              typeof data.age === 'number' ? data.age : null,
        musicTaste:       typeof data.music_taste === 'string' && data.music_taste.trim() ? data.music_taste : null,
        typicalBudget:    isBudgetTier(data.typical_budget) ? data.typical_budget : null,
        dressStyle:       typeof data.dress_style === 'string' && data.dress_style.trim() ? data.dress_style : null,
        groupSizeTypical: typeof data.group_size_typical === 'number' ? data.group_size_typical : null,
        vibesLiked:       liked,
        vibesDisliked:    disliked,
        homeCity:         typeof data.home_city === 'string' && data.home_city.trim() ? data.home_city : null,
        hasAnyData:       false,
      };
      next.hasAnyData = !!(
        next.age != null
        || next.musicTaste
        || next.typicalBudget
        || next.dressStyle
        || next.groupSizeTypical != null
        || next.vibesLiked.length
        || next.vibesDisliked.length
      );
      setVibe(next);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [authId]);

  return { ...vibe, loading };
}
