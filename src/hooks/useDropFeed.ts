import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { getEventTimeLabel } from '../lib/eventUtils';
import type { VenueEvent } from '../lib/types';

export type DropMessageType = 'message' | 'event' | 'surge';

export interface DropMessage {
  id: string;
  type: DropMessageType;
  venue_id: string;
  venue_name: string;
  venue_featured?: boolean;  // featured venue → thicker stripe + ⭐ prefix
  hue_degrees: number;       // 0-360, drives left-stripe color
  body: string;              // main text
  subline?: string;          // optional context (time ago, capacity, etc.)
  icon: string;              // emoji per type
  event_type?: VenueEvent['event_type'];
  raw?: VenueEvent | VenueUpdateRow;  // original record (for click handlers)
  created_at: string;
}

interface VenueUpdateRow {
  id: string;
  venue_id: string;
  venue_name: string;
  message: string;
  created_at: string;
}

interface HeatPointRow {
  venue_id: string;
  name: string;
  state_label: string;
  capacity_pct: number;
  estimate: number;
  last_calculated_at: string | null;
}

function getTonightCutoff(): string {
  const now = new Date();
  const cutoff = new Date(now);
  if (now.getHours() < 5) cutoff.setDate(cutoff.getDate() - 1);
  cutoff.setHours(4, 0, 0, 0);
  return cutoff.toISOString();
}

const SURGE_TTL_MS = 15 * 60 * 1000;  // surges age out after 15 min

interface UseDropFeedProps {
  venueIds: string[];
  featuredVenueIds?: Set<string>;
  events?: VenueEvent[];
}

/**
 * Unified Drop feed: merges bar messages (venue_updates), venue events
 * (passed in), and live surge events (detected from heat_points
 * state_label transitions). Each message carries the venue's current hue
 * (heat_points.hue_degrees) so the UI renders a colored left stripe.
 *
 * Path A — pure client-side. No DB migration. Surges are ephemeral
 * (15-min lifetime in the feed).
 */
export function useDropFeed({ venueIds, featuredVenueIds, events }: UseDropFeedProps) {
  const [updates, setUpdates] = useState<VenueUpdateRow[]>([]);
  const [surges, setSurges] = useState<DropMessage[]>([]);
  const [venueHues, setVenueHues] = useState<Map<string, number>>(new Map());

  // Track previous surging set so we only emit on TRANSITION into surge.
  const prevSurgingRef = useRef<Set<string>>(new Set());

  const venueIdKey = venueIds.join(',');

  // 1. Fetch venue hues (heat_points.hue_degrees) for the color stripes.
  useEffect(() => {
    if (venueIds.length === 0) {
      setVenueHues(new Map());
      return;
    }
    let cancelled = false;
    const fetchHues = async () => {
      const { data, error } = await supabase
        .from('heat_points')
        .select('venue_id, hue_degrees')
        .in('venue_id', venueIds);
      if (cancelled || error || !data) return;
      const m = new Map<string, number>();
      for (const row of data as { venue_id: string; hue_degrees: number | null }[]) {
        if (row.hue_degrees != null) m.set(row.venue_id, row.hue_degrees);
      }
      setVenueHues(m);
    };
    fetchHues();
    // Poll every 60s so stripes stay fresh as paints re-color venues.
    const interval = window.setInterval(fetchHues, 60_000);
    return () => { cancelled = true; window.clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueIdKey]);

  // 2. Bar messages (venue_updates) + realtime INSERT subscription.
  useEffect(() => {
    if (venueIds.length === 0) {
      setUpdates([]);
      return;
    }
    const cutoff = getTonightCutoff();
    const venueIdSet = new Set(venueIds);
    const fetchUpdates = async () => {
      const { data } = await supabase
        .from('venue_updates')
        .select('id, venue_id, venue_name, message, created_at')
        .in('venue_id', venueIds)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(25);
      setUpdates((data as VenueUpdateRow[] | null) || []);
    };
    fetchUpdates();
    const channel = supabase
      .channel(`drop-feed-updates-${Date.now()}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'venue_updates',
      }, (payload) => {
        const row = payload.new as VenueUpdateRow;
        if (row.created_at >= cutoff && venueIdSet.has(row.venue_id)) {
          setUpdates(prev => [row, ...prev.filter(u => u.id !== row.id)].slice(0, 25));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueIdKey]);

  // 3. Surge detection: poll heat_points, emit a DropMessage when a venue
  //    transitions INTO state_label='Surging'. Aged out after SURGE_TTL_MS.
  useEffect(() => {
    if (venueIds.length === 0) {
      setSurges([]);
      return;
    }

    const pollHeatPoints = async () => {
      const { data } = await supabase
        .from('heat_points')
        .select('venue_id, name, state_label, capacity_pct, estimate, last_calculated_at')
        .in('venue_id', venueIds);
      if (!data) return;

      const rows = data as HeatPointRow[];
      const currentSurging = new Set<string>();
      const newSurgeMessages: DropMessage[] = [];

      for (const row of rows) {
        if (row.state_label === 'Surging') {
          currentSurging.add(row.venue_id);
          if (!prevSurgingRef.current.has(row.venue_id)) {
            newSurgeMessages.push({
              id: `surge-${row.venue_id}-${Date.now()}`,
              type: 'surge',
              venue_id: row.venue_id,
              venue_name: row.name,
              hue_degrees: 0,  // filled by the merge step from venueHues
              body: `${row.name} is surging`,
              subline: row.estimate
                ? `${row.estimate} inside · ${Math.round(row.capacity_pct * 100)}% full`
                : 'lots of activity',
              icon: '\u{1F525}',  // 🔥
              created_at: row.last_calculated_at || new Date().toISOString(),
            });
          }
        }
      }

      prevSurgingRef.current = currentSurging;

      const cutoff = Date.now() - SURGE_TTL_MS;
      setSurges(prev => {
        const fresh = prev.filter(s => new Date(s.created_at).getTime() > cutoff);
        return newSurgeMessages.length > 0 ? [...newSurgeMessages, ...fresh] : fresh;
      });
    };

    pollHeatPoints();
    const interval = window.setInterval(pollHeatPoints, 30_000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueIdKey]);

  // 4. Merge all three sources into one chronological feed.
  const feed: DropMessage[] = useMemo(() => {
    const messageItems: DropMessage[] = updates.map(u => ({
      id: `msg-${u.id}`,
      type: 'message',
      venue_id: u.venue_id,
      venue_name: u.venue_name,
      venue_featured: featuredVenueIds?.has(u.venue_id) ?? false,
      hue_degrees: venueHues.get(u.venue_id) ?? 45,  // default yellow-gold
      body: u.message,
      icon: '\u{1F4AC}',  // 💬
      raw: u,
      created_at: u.created_at,
    }));

    const eventItems: DropMessage[] = (events || []).map(e => {
      const eventIcons: Record<VenueEvent['event_type'], string> = {
        party: '\u{1F389}', brand: '\u{1F48E}', greek: '\u{1F3DB}',
        launch: '\u{1F680}', special: '\u{2B50}',
      };
      const tl = getEventTimeLabel(e.start_time, e.expires_at);
      return {
        id: `event-${e.id}`,
        type: 'event' as const,
        venue_id: e.venue_id ?? '',
        venue_name: e.host_name || 'Event',
        venue_featured: e.venue_id ? (featuredVenueIds?.has(e.venue_id) ?? false) : false,
        hue_degrees: (e.venue_id ? venueHues.get(e.venue_id) : undefined) ?? 45,
        body: e.title || 'Event tonight',
        subline: tl?.text,
        icon: eventIcons[e.event_type] || '\u{2B50}',
        event_type: e.event_type,
        raw: e,
        created_at: e.created_at || new Date().toISOString(),
      };
    });

    const surgeItems: DropMessage[] = surges.map(s => ({
      ...s,
      venue_featured: featuredVenueIds?.has(s.venue_id) ?? false,
      hue_degrees: venueHues.get(s.venue_id) ?? s.hue_degrees,
    }));

    const merged = [...messageItems, ...eventItems, ...surgeItems];
    merged.sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return merged;
  }, [updates, events, surges, venueHues, featuredVenueIds]);

  return { feed, totalCount: feed.length };
}
