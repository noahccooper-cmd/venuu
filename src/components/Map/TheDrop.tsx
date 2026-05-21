import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { timeAgo } from '../../lib/utils';
import { getEventTimeLabel } from '../../lib/eventUtils';
import { hapticHeavy } from '../../lib/haptics';
import type { VenueEvent } from '../../lib/types';

/** Returns a full ISO 8601 timestamp for 4:00 AM on the current "night" date (4am rollover). */
function getTonightCutoff(): string {
  const now = new Date();
  const cutoff = new Date(now);
  if (now.getHours() < 5) {
    cutoff.setDate(cutoff.getDate() - 1);
  }
  cutoff.setHours(4, 0, 0, 0);
  return cutoff.toISOString();
}

interface VenueUpdate {
  id: string;
  venue_id: string;
  venue_name: string;
  message: string;
  created_at: string;
}

const FONT = 'Satoshi, sans-serif';
const BLUE = '#00D4FF';
const ORANGE = '#FF8200';

const EVENT_TYPE_EMOJI: Record<VenueEvent['event_type'], string> = {
  party: '\u{1F389}',
  brand: '\u{1F48E}',
  greek: '\u{1F3DB}',
  launch: '\u{1F680}',
  special: '\u{2B50}',
};

const EVENT_TYPE_LABELS: Record<VenueEvent['event_type'], string> = {
  party: 'Party',
  brand: 'Brand',
  greek: 'Greek',
  launch: 'Launch',
  special: 'Special',
};


interface TheDropProps {
  venues: { id: string; lat: number; lng: number; category?: string }[];
  events?: VenueEvent[];
  onFlyTo: (lng: number, lat: number) => void;
  onEventTap?: (event: VenueEvent) => void;
}

export function TheDrop({ venues, events, onFlyTo, onEventTap }: TheDropProps) {
  const [updates, setUpdates] = useState<VenueUpdate[]>([]);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [flash, setFlash] = useState(false);
  const [urgencyPulse, setUrgencyPulse] = useState(false);
  const prevCountRef = useRef(0);
  const pillRef = useRef<HTMLButtonElement>(null);
  const urgencyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable set of venue IDs for the current city
  const venueIds = useMemo(() => venues.map(v => v.id), [venues]);
  const venueIdSet = useMemo(() => new Set(venueIds), [venueIds]);

  // Active (non-expired) events
  const activeEvents = useMemo(() => {
    if (!events) return [];
    const now = new Date();
    return events.filter(e => e.is_active && new Date(e.expires_at) > now);
  }, [events]);

  // Fetch active updates for current city's venues + realtime subscription
  useEffect(() => {
    if (venueIds.length === 0) {
      setUpdates([]);
      prevCountRef.current = 0;
      return;
    }

    const cutoff = getTonightCutoff();
    const fetchUpdates = async () => {
      const { data, error } = await supabase
        .from('venue_updates')
        .select('id, venue_id, venue_name, message, created_at')
        .in('venue_id', venueIds)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(15);
      if (error) {
        console.error('[drop] Fetch error:', error.message);
        return;
      }
      if (data) {
        setUpdates(data);
        prevCountRef.current = data.length;
      }
    };
    fetchUpdates();

    // Realtime: filter client-side since Supabase doesn't support .in() on subscriptions
    const channel = supabase
      .channel(`the-drop-rt-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'venue_updates' },
        (payload) => {
          const row = payload.new as VenueUpdate;
          if (row.created_at >= cutoff && venueIdSet.has(row.venue_id)) {
            setUpdates(prev => [row, ...prev].slice(0, 15));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [venueIds, venueIdSet]);

  // Flash pill + urgency pulse when count increases (new update arrives)
  useEffect(() => {
    if (updates.length > prevCountRef.current && prevCountRef.current >= 0) {
      hapticHeavy();
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 600);

      // Urgency pulse: 3 cycles then stop after 30s
      setUrgencyPulse(true);
      if (urgencyTimerRef.current) clearTimeout(urgencyTimerRef.current);
      urgencyTimerRef.current = setTimeout(() => setUrgencyPulse(false), 30000);

      prevCountRef.current = updates.length;
      return () => clearTimeout(t);
    }
    prevCountRef.current = updates.length;
  }, [updates.length]);

  // Check newest update freshness on mount
  useEffect(() => {
    if (updates.length > 0) {
      const newest = new Date(updates[0].created_at).getTime();
      const age = Date.now() - newest;
      if (age < 30000) {
        setUrgencyPulse(true);
        if (urgencyTimerRef.current) clearTimeout(urgencyTimerRef.current);
        urgencyTimerRef.current = setTimeout(() => setUrgencyPulse(false), 30000 - age);
      }
    }
    return () => { if (urgencyTimerRef.current) clearTimeout(urgencyTimerRef.current); };
  }, [updates]);

  const handlePillClick = useCallback(() => {
    if (open) {
      // Start close animation
      setClosing(true);
      setTimeout(() => {
        setOpen(false);
        setClosing(false);
      }, 150);
    } else {
      setOpen(true);
    }
  }, [open]);

  const handleUpdateClick = useCallback((venueId: string) => {
    const v = venues.find(x => x.id === venueId);
    if (v) onFlyTo(v.lng, v.lat);
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 150);
  }, [venues, onFlyTo]);

  const handleEventCardClick = useCallback((event: VenueEvent) => {
    // Fly to event location
    let lng = event.longitude;
    let lat = event.latitude;
    if (event.venue_id) {
      const v = venues.find(x => x.id === event.venue_id);
      if (v) { lng = v.lng; lat = v.lat; }
    }
    onFlyTo(lng, lat);
    // Close The Drop and show the event card on the map
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
      onEventTap?.(event);
    }, 150);
  }, [venues, onFlyTo, onEventTap]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setClosing(true);
      setTimeout(() => {
        setOpen(false);
        setClosing(false);
      }, 150);
    }
  }, []);

  const totalCount = updates.length + activeEvents.length;
  const hasContent = totalCount > 0;

  return (
    <>
      {/* Pill */}
      <div className="drop-pill-wrapper" style={{
        position: 'absolute',
        top: 'calc(env(safe-area-inset-top) + 125px)',
        left: 0,
        right: 0,
        // Rides above the VennyBar pill (zIndex 590) so the revenue
        // surface always wins z-order conflicts at the top of the map.
        zIndex: 600,
        display: 'flex',
        justifyContent: 'center',
        padding: '6px 0',
        pointerEvents: 'none',
      }}>
        <button
          ref={pillRef}
          onClick={handlePillClick}
          className={`${hasContent ? 'drop-pill-glow' : ''} ${flash ? 'drop-pill-flash' : ''} ${urgencyPulse ? 'drop-pill-urgency' : ''}`}
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 14px',
            borderRadius: '20px',
            background: hasContent ? 'rgba(255, 130, 0, 0.15)' : 'rgba(255,255,255,0.06)',
            border: hasContent ? '1px solid rgba(255, 130, 0, 0.3)' : '1px solid rgba(255,255,255,0.1)',
            color: hasContent ? ORANGE : 'rgba(255,255,255,0.35)',
            fontFamily: FONT,
            fontSize: '12px',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          {'\uD83D\uDCE3'} {hasContent ? `${totalCount} update${totalCount === 1 ? '' : 's'} tonight` : 'No updates tonight'}
        </button>
      </div>

      {/* Feed overlay */}
      {open && (
        <div
          onClick={handleBackdropClick}
          className={closing ? 'drop-backdrop-out' : 'drop-backdrop-in'}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 350,
            background: 'rgba(5, 5, 7, 0.7)',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            className={closing ? 'drop-feed-out' : 'drop-feed-in'}
            style={{
              position: 'absolute',
              top: '60px',
              left: '12px',
              right: '12px',
              maxHeight: '60vh',
              borderRadius: '16px',
              background: '#111114',
              border: '1px solid rgba(255,255,255,0.1)',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{
              fontSize: '11px',
              fontWeight: 700,
              color: 'rgba(255,255,255,0.4)',
              letterSpacing: '1px',
              textTransform: 'uppercase',
              padding: '0 4px 4px',
            }}>
              {'\uD83D\uDCE3'} THE DROP
            </div>

            {/* Scrollable content */}
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '0px' }}>

              {/* ── Pinned Events Section ── */}
              {activeEvents.length > 0 && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  maxHeight: '40%',
                  overflowY: 'auto',
                  flexShrink: 0,
                  paddingBottom: '0px',
                }}>
                  {activeEvents.map(evt => (
                    <button
                      key={evt.id}
                      onClick={() => handleEventCardClick(evt)}
                      className="drop-event-card-enter"
                      style={{
                        background: 'rgba(0, 212, 255, 0.04)',
                        borderLeft: `3px solid ${BLUE}`,
                        border: `1px solid rgba(0, 212, 255, 0.15)`,
                        borderLeftWidth: '3px',
                        borderLeftColor: BLUE,
                        borderRadius: '10px',
                        padding: '10px 12px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                    >
                      {/* Badge */}
                      <span style={{
                        fontFamily: FONT,
                        fontSize: 10,
                        fontWeight: 700,
                        color: BLUE,
                        background: 'rgba(0, 212, 255, 0.12)',
                        border: '1px solid rgba(0, 212, 255, 0.25)',
                        borderRadius: 12,
                        padding: '2px 8px',
                        letterSpacing: '0.5px',
                        textTransform: 'uppercase',
                        alignSelf: 'flex-start',
                        marginBottom: '6px',
                      }}>
                        {EVENT_TYPE_EMOJI[evt.event_type]} {EVENT_TYPE_LABELS[evt.event_type]}
                      </span>
                      {/* TIME — the hook */}
                      {(() => {
                        const tl = getEventTimeLabel(evt.start_time, evt.expires_at);
                        return (
                          <p style={{
                            fontSize: '16px',
                            fontWeight: 800,
                            color: tl.isNow ? '#00FF88' : BLUE,
                            margin: '0 0 4px',
                            lineHeight: 1.2,
                            fontFamily: FONT,
                            letterSpacing: '0.5px',
                          }}>
                            {tl.isNow ? '\u26A1' : '\uD83D\uDD59'} {tl.text}
                          </p>
                        );
                      })()}
                      {/* Title */}
                      <p style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        color: 'white',
                        margin: '0 0 2px',
                        lineHeight: '1.3',
                        fontFamily: FONT,
                      }}>
                        {evt.title}
                      </p>
                      {/* Host */}
                      <p style={{
                        fontSize: '11px',
                        color: BLUE,
                        margin: 0,
                        fontFamily: FONT,
                        fontWeight: 600,
                        opacity: 0.8,
                      }}>
                        {evt.host_name}
                      </p>
                    </button>
                  ))}
                </div>
              )}

              {/* ── Divider between events and live feed ── */}
              {activeEvents.length > 0 && updates.length > 0 && (
                <div style={{ padding: '8px 4px 6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
                  <span style={{
                    fontFamily: FONT,
                    fontSize: '10px',
                    fontWeight: 700,
                    color: ORANGE,
                    letterSpacing: '1.5px',
                    textTransform: 'uppercase',
                    flexShrink: 0,
                  }}>
                    LIVE
                  </span>
                  <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
                </div>
              )}

              {/* ── Live Drop Messages ── */}
              {updates.length === 0 && activeEvents.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  color: 'rgba(255,255,255,0.3)',
                  fontSize: '13px',
                  padding: '20px 0',
                  fontFamily: FONT,
                }}>
                  No updates tonight yet
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: activeEvents.length > 0 && updates.length > 0 ? '0px' : '4px' }}>
                  {updates.map(u => (
                    <button
                      key={u.id}
                      onClick={() => handleUpdateClick(u.venue_id)}
                      style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '10px',
                        padding: '10px 12px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: venues.find(v => v.id === u.venue_id)?.category === 'fraternity' ? '#C9A96E' : ORANGE, fontFamily: FONT }}>
                          {u.venue_name}
                        </span>
                        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontFamily: FONT }}>
                          {timeAgo(u.created_at)}
                        </span>
                      </div>
                      <p style={{ fontSize: '13px', color: 'white', margin: 0, lineHeight: '1.35', fontFamily: FONT }}>
                        {u.message}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
