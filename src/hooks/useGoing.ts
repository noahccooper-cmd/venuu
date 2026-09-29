import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { SOCIAL_DEMO } from '../lib/socialMode';
import type { SocialEvent } from '../lib/socialTypes';

/**
 * "Going" for Social events.
 *
 * Live: event_rsvps (user_id = profiles.id; policy fixed in 00077) and
 * events.going_count (kept by the bump_event_going_count trigger). Counts
 * update for everyone via realtime on events. Avatars come only from
 * public_profiles (signed-in readers — event_rsvps isn't readable
 * signed out, so signed-out viewers see the count only).
 *
 * Demo builds: local only (localStorage), with demo counts/initials.
 */

export interface GoingFace { id: string; initials: string }

export interface GoingState {
  count: (ev: SocialEvent) => number;
  isGoing: (id: string) => boolean;
  faces: (id: string) => GoingFace[];
  /** Optimistic; resolves false (and rolls back) on error. */
  toggle: (ev: SocialEvent, on: boolean) => Promise<boolean>;
}

const DEMO_KEY = 'social-demo-going';
const DEMO_NAMES = ['Ava M.', 'Jordan T.', 'Maya R.', 'Chris L.', 'Sam K.', 'Riley P.', 'Noor A.', 'Eli S.', 'Tess W.'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
const initialsOf = (name: string) => name.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase();

function loadDemo(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DEMO_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
function saveDemo(s: Set<string>): void {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify([...s])); } catch { /* not persisted */ }
}

export function useGoing(profileId: string | null, visibleIds: string[]): GoingState {
  const [mine, setMine] = useState<Set<string>>(() => (SOCIAL_DEMO ? loadDemo() : new Set()));
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [faces, setFaces] = useState<Record<string, GoingFace[]>>({});
  const visibleKey = visibleIds.join(',');
  const pending = useRef(new Set<string>());

  // ── Live: my RSVPs ──
  useEffect(() => {
    if (SOCIAL_DEMO || !profileId || !supabase) { if (!SOCIAL_DEMO) setMine(new Set()); return; }
    let live = true;
    (async () => {
      const { data } = await supabase.from('event_rsvps').select('event_id').eq('user_id', profileId);
      if (live && data) setMine(new Set(data.map(r => (r as { event_id: string }).event_id)));
    })();
    return () => { live = false; };
  }, [profileId]);

  // ── Live: faces for the cards on screen (public_profiles only) ──
  useEffect(() => {
    if (SOCIAL_DEMO || !profileId || !supabase || !visibleKey) return;
    let live = true;
    (async () => {
      const ids = visibleKey.split(',');
      const { data: rsvps } = await supabase.from('event_rsvps').select('event_id, user_id').in('event_id', ids).limit(ids.length * 3 + 20);
      const rows = (rsvps ?? []) as { event_id: string; user_id: string }[];
      const users = [...new Set(rows.map(r => r.user_id))];
      if (!users.length) { if (live) setFaces({}); return; }
      const { data: profs } = await supabase.from('public_profiles').select('id, display_name, username').in('id', users);
      const byId = new Map(((profs ?? []) as { id: string; display_name: string | null; username: string | null }[])
        .map(p => [p.id, initialsOf(p.display_name || p.username || '')]));
      const next: Record<string, GoingFace[]> = {};
      for (const r of rows) {
        const ini = byId.get(r.user_id);
        if (!ini) continue;                       // not public → count only
        const list = (next[r.event_id] ??= []);
        if (list.length < 3) list.push({ id: r.user_id, initials: ini });
      }
      if (live) setFaces(next);
    })();
    return () => { live = false; };
  }, [profileId, visibleKey]);

  // ── Live: going_count for everyone (events is in supabase_realtime) ──
  useEffect(() => {
    if (SOCIAL_DEMO || !supabase) return;
    const ch = supabase
      .channel('social-going')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: 'surface=eq.social' }, payload => {
        const row = payload.new as { id?: string; going_count?: number };
        if (row.id && typeof row.going_count === 'number' && !pending.current.has(row.id)) {
          setCounts(c => ({ ...c, [row.id!]: row.going_count! }));
        }
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  const count = useCallback((ev: SocialEvent) => {
    if (SOCIAL_DEMO) return 3 + (hash(ev.id) % 38) + (mine.has(ev.id) ? 1 : 0);
    return counts[ev.id] ?? ev.going_count ?? 0;
  }, [counts, mine]);

  const facesOf = useCallback((id: string): GoingFace[] => {
    if (!SOCIAL_DEMO) return faces[id] ?? [];
    const h = hash(id);
    return [0, 1, 2].map(i => {
      const n = DEMO_NAMES[(h + i * 7) % DEMO_NAMES.length];
      return { id: `${id}-${i}`, initials: initialsOf(n) };
    });
  }, [faces]);

  const toggle = useCallback(async (ev: SocialEvent, on: boolean): Promise<boolean> => {
    const apply = (want: boolean) => setMine(prev => {
      const next = new Set(prev);
      if (want) next.add(ev.id); else next.delete(ev.id);
      if (SOCIAL_DEMO) saveDemo(next);
      return next;
    });
    const before = mine.has(ev.id);
    if (before === on) return true;
    apply(on);
    if (SOCIAL_DEMO) return true;
    if (!profileId || !supabase) { apply(before); return false; }
    const base = counts[ev.id] ?? ev.going_count ?? 0;
    setCounts(c => ({ ...c, [ev.id]: Math.max(0, base + (on ? 1 : -1)) }));
    pending.current.add(ev.id);
    const { error } = on
      ? await supabase.from('event_rsvps').insert({ user_id: profileId, event_id: ev.id })
      : await supabase.from('event_rsvps').delete().eq('user_id', profileId).eq('event_id', ev.id);
    pending.current.delete(ev.id);
    if (error) {
      apply(before);
      setCounts(c => ({ ...c, [ev.id]: base }));
      return false;
    }
    return true;
  }, [mine, profileId, counts]);

  return useMemo(() => ({ count, isGoing: (id: string) => mine.has(id), faces: facesOf, toggle }), [count, mine, facesOf, toggle]);
}
