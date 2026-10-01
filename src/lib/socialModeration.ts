/**
 * Moderation and owner actions on Social events. Live builds go through
 * Supabase (RLS + the 00077 guard decide who may do what); demo builds
 * keep everything in this browser.
 */

import { createContext } from 'react';
import type { SocialEvent } from './socialTypes';
import { supabase } from './supabase';
import { SOCIAL_DEMO } from './socialMode';
import { mapPostError, type PostErrorCode } from './socialPost';

export type ReportReason = 'spam' | 'inappropriate' | 'wrong_info' | 'other';
export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'inappropriate', label: 'Inappropriate' },
  { value: 'wrong_info', label: 'Wrong info' },
  { value: 'other', label: 'Something else' },
];

export type ActionResult = { ok: true } | { ok: false; code: PostErrorCode | 'duplicate' };

/** The demo user's id for owner checks on demo posts. */
export const DEMO_ME = 'demo-me';

const DEMO_EVENTS_KEY = 'social-demo-events';
const DEMO_REPORTS_KEY = 'social-demo-reports';
const DEMO_BLOCKS_KEY = 'social-demo-blocks';
const DEMO_OVERRIDES_KEY = 'social-demo-overrides';

function readJSON<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
}
function writeJSON(k: string, v: unknown): void {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not persisted */ }
}
/** Demo: change an event — demo posts in place; fixtures via overrides
 *  (null = deleted) applied when the demo data is read. */
function patchDemo(id: string, patch: Partial<SocialEvent> | null): void {
  const rows = readJSON<SocialEvent[]>(DEMO_EVENTS_KEY, []);
  if (rows.some(r => r.id === id)) {
    const next = patch === null ? rows.filter(r => r.id !== id) : rows.map(r => (r.id === id ? { ...r, ...patch } : r));
    writeJSON(DEMO_EVENTS_KEY, next);
  } else {
    const o = readJSON<Record<string, Partial<SocialEvent> | null>>(DEMO_OVERRIDES_KEY, {});
    o[id] = patch === null ? null : { ...(o[id] ?? {}), ...patch };
    writeJSON(DEMO_OVERRIDES_KEY, o);
  }
  window.dispatchEvent(new CustomEvent('venuu:social-demo-events'));
}

/** Demo: apply local overrides to fixture rows. */
export function applyDemoOverrides(rows: SocialEvent[]): SocialEvent[] {
  const o = readJSON<Record<string, Partial<SocialEvent> | null>>(DEMO_OVERRIDES_KEY, {});
  return rows.flatMap(r => (r.id in o ? (o[r.id] === null ? [] : [{ ...r, ...o[r.id] }]) : [r]));
}

const fail = (e: { message?: string; code?: string } | null): ActionResult =>
  ({ ok: false, code: e?.code === '23505' ? 'duplicate' : mapPostError(e) });

export async function reportEvent(ev: SocialEvent, reporterId: string | null, reason: ReportReason, details: string): Promise<ActionResult> {
  if (SOCIAL_DEMO) {
    const all = readJSON<{ event_id: string; title: string; reason: ReportReason; details: string; at: string }[]>(DEMO_REPORTS_KEY, []);
    if (all.some(r => r.event_id === ev.id)) return { ok: false, code: 'duplicate' };
    writeJSON(DEMO_REPORTS_KEY, [...all, { event_id: ev.id, title: ev.title, reason, details, at: new Date().toISOString() }]);
    return { ok: true };
  }
  if (!reporterId || !supabase) return { ok: false, code: 'signed_out' };
  const { error } = await supabase.from('event_reports').insert({ event_id: ev.id, reporter_profile_id: reporterId, reason, details: details.trim() || null });
  return error ? fail(error) : { ok: true };
}

export async function blockPoster(me: string | null, posterId: string): Promise<ActionResult> {
  if (SOCIAL_DEMO) { writeJSON(DEMO_BLOCKS_KEY, [...new Set([...readJSON<string[]>(DEMO_BLOCKS_KEY, []), posterId])]); return { ok: true }; }
  if (!me || !supabase) return { ok: false, code: 'signed_out' };
  const { error } = await supabase.from('user_blocks').insert({ blocker_profile_id: me, blocked_profile_id: posterId });
  return error && error.code !== '23505' ? fail(error) : { ok: true };
}

export async function loadBlocks(me: string | null): Promise<Set<string>> {
  if (SOCIAL_DEMO) return new Set(readJSON<string[]>(DEMO_BLOCKS_KEY, []));
  if (!me || !supabase) return new Set();
  const { data } = await supabase.from('user_blocks').select('blocked_profile_id').eq('blocker_profile_id', me);
  return new Set(((data ?? []) as { blocked_profile_id: string }[]).map(r => r.blocked_profile_id));
}

export async function editEvent(ev: SocialEvent, patch: { title: string; description: string | null }): Promise<ActionResult> {
  if (SOCIAL_DEMO) { patchDemo(ev.id, patch); return { ok: true }; }
  if (!supabase) return { ok: false, code: 'network' };
  const { error } = await supabase.from('events').update(patch).eq('id', ev.id);
  return error ? fail(error) : { ok: true };
}

export async function deleteEvent(ev: SocialEvent): Promise<ActionResult> {
  if (SOCIAL_DEMO) { patchDemo(ev.id, null); return { ok: true }; }
  if (!supabase) return { ok: false, code: 'network' };
  const { error } = await supabase.from('events').delete().eq('id', ev.id);
  return error ? fail(error) : { ok: true };
}

export async function setVerification(ev: SocialEvent, v: 'verified' | 'denied'): Promise<ActionResult> {
  if (SOCIAL_DEMO) { patchDemo(ev.id, { verification: v }); return { ok: true }; }
  if (!supabase) return { ok: false, code: 'network' };
  const { error } = await supabase.from('events').update({ verification: v }).eq('id', ev.id);
  return error ? fail(error) : { ok: true };
}

export async function banPoster(posterId: string): Promise<ActionResult> {
  if (SOCIAL_DEMO) return { ok: true };
  if (!supabase) return { ok: false, code: 'network' };
  const { error } = await supabase.from('profiles').update({ posting_banned: true }).eq('id', posterId);
  return error ? fail(error) : { ok: true };
}

export async function markDenialSeen(ids: string[]): Promise<void> {
  if (SOCIAL_DEMO) { for (const id of ids) patchDemo(id, { denial_seen_at: new Date().toISOString() }); return; }
  if (!supabase || !ids.length) return;
  await supabase.from('events').update({ denial_seen_at: new Date().toISOString() }).in('id', ids);
}

export interface ReportRow { id: string; event_id: string; title: string; reason: ReportReason; details: string | null; created_at: string }

export async function loadReports(): Promise<ReportRow[]> {
  if (SOCIAL_DEMO) {
    return readJSON<{ event_id: string; title: string; reason: ReportReason; details: string; at: string }[]>(DEMO_REPORTS_KEY, [])
      .map((r, i) => ({ id: `demo-report-${i}`, event_id: r.event_id, title: r.title, reason: r.reason, details: r.details || null, created_at: r.at }))
      .reverse();
  }
  if (!supabase) return [];
  const { data } = await supabase.from('event_reports').select('id, event_id, reason, details, created_at, events(title)').order('created_at', { ascending: false }).limit(100);
  return ((data ?? []) as unknown as { id: string; event_id: string; reason: ReportReason; details: string | null; created_at: string; events: { title: string } | { title: string }[] | null }[])
    .map(r => ({ id: r.id, event_id: r.event_id, reason: r.reason, details: r.details, created_at: r.created_at, title: (Array.isArray(r.events) ? r.events[0]?.title : r.events?.title) ?? 'Removed event' }));
}

export async function dismissReport(r: ReportRow): Promise<ActionResult> {
  if (SOCIAL_DEMO) {
    const all = readJSON<{ event_id: string }[]>(DEMO_REPORTS_KEY, []);
    writeJSON(DEMO_REPORTS_KEY, all.filter(x => x.event_id !== r.event_id));
    return { ok: true };
  }
  if (!supabase) return { ok: false, code: 'network' };
  const { error } = await supabase.from('event_reports').delete().eq('id', r.id);
  return error ? fail(error) : { ok: true };
}

/** What the detail sheet needs to show owner / admin / report actions. */
export interface SocialActions {
  meId: string | null;
  signedIn: boolean;
  isAdmin: boolean;
  /** Runs an action, shows the toast/haptic, refreshes data. */
  run: (label: string, fn: () => Promise<ActionResult>, after?: () => void) => Promise<boolean>;
  requireSignIn: () => void;
}

export const SocialActionsContext = createContext<SocialActions | null>(null);
