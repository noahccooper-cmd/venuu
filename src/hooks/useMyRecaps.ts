import { useState, useEffect } from 'react';
import { supabase, envReady } from '../lib/supabase';

export interface MyRecap {
  id: string;
  created_at: string;
  venue_id: string;
  venue_name: string;
  username: string;
  body: string | null;
  day_of: string;
  photo_url: string;
  hue_at_capture: number;
  developed_at: string;
  /** The user's personal count when they captured this moment.
   *  Engraved in the JPEG bottom-right + displayed in the orb
   *  badge top-right. Null on pre-migration legacy rows (safe). */
  user_moment_number: number | null;
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
      .select('id, created_at, venue_id, username, body, day_of, photo_url, hue_at_capture, developed_at, user_moment_number, venues(name)')
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
          day_of: r.day_of,
          photo_url: r.photo_url,
          hue_at_capture: r.hue_at_capture,
          developed_at: r.developed_at,
          user_moment_number: r.user_moment_number ?? null,
        }));
        setRecaps(rows);
        setLoading(false);
      });
  }, [username]);

  return { recaps, loading };
}
