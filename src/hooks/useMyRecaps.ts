import { useState, useEffect } from 'react';
import { supabase, envReady } from '../lib/supabase';

export interface MyRecap {
  id: string;
  created_at: string;
  venue_id: string;
  venue_name: string;
  username: string;
  body: string;
  stars: number;
  day_of: string;
}

export function useMyRecaps(username: string | null) {
  const [recaps, setRecaps] = useState<MyRecap[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!envReady || !username) {
      setRecaps([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    supabase
      .from('venue_recaps')
      .select('id, created_at, venue_id, username, body, stars, day_of, venues(name)')
      .eq('username', username)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (error) {
          console.error('[my-recaps] Fetch error:', error.message);
          setLoading(false);
          return;
        }
        const rows = (data ?? []).map((r: any) => ({
          id: r.id,
          created_at: r.created_at,
          venue_id: r.venue_id,
          venue_name: r.venues?.name ?? 'Unknown venue',
          username: r.username,
          body: r.body,
          stars: r.stars,
          day_of: r.day_of,
        }));
        setRecaps(rows);
        setLoading(false);
      });
  }, [username]);

  return { recaps, loading };
}
