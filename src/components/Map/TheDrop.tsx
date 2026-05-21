import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { timeAgo } from '../../lib/utils';
import { hapticHeavy } from '../../lib/haptics';
import type { VenueEvent } from '../../lib/types';
import { useDropFeed } from '../../hooks/useDropFeed';

const FONT = 'Satoshi, sans-serif';
const ORANGE = '#FF8200';


interface TheDropProps {
  venues: { id: string; lat: number; lng: number; category?: string }[];
  events?: VenueEvent[];
  onFlyTo: (lng: number, lat: number) => void;
  onEventTap?: (event: VenueEvent) => void;
}

export function TheDrop({ venues, events, onFlyTo, onEventTap }: TheDropProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [flash, setFlash] = useState(false);
  const [urgencyPulse, setUrgencyPulse] = useState(false);

  // Broadcast open/closed so body-level pills (VennyBar, the ticker) can
  // fade out while a drop is being read — same event-bus pattern as
  // venuu:globe-state. Stats card stays (it's the masthead).
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('venuu:drop-state', { detail: { isOpen: open } }));
  }, [open]);
  const prevCountRef = useRef(0);
  const pillRef = useRef<HTMLButtonElement>(null);
  const urgencyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable set of venue IDs for the current city
  const venueIds = useMemo(() => venues.map(v => v.id), [venues]);

  // Active (non-expired) events
  const activeEvents = useMemo(() => {
    if (!events) return [];
    const now = new Date();
    return events.filter(e => e.is_active && new Date(e.expires_at) > now);
  }, [events]);

  // Unified feed: bar messages + events + live surges, each carrying the
  // venue's current hue (heat_points.hue_degrees) for the colored stripe.
  const { feed, totalCount } = useDropFeed({ venueIds, events: activeEvents });
  const hasContent = totalCount > 0;

  // Flash pill + urgency pulse when the feed grows (new content arrives)
  useEffect(() => {
    if (totalCount > prevCountRef.current && prevCountRef.current >= 0) {
      hapticHeavy();
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 600);

      // Urgency pulse: 3 cycles then stop after 30s
      setUrgencyPulse(true);
      if (urgencyTimerRef.current) clearTimeout(urgencyTimerRef.current);
      urgencyTimerRef.current = setTimeout(() => setUrgencyPulse(false), 30000);

      prevCountRef.current = totalCount;
      return () => clearTimeout(t);
    }
    prevCountRef.current = totalCount;
  }, [totalCount]);

  // Check newest feed item freshness on mount
  useEffect(() => {
    if (feed.length > 0) {
      const newest = new Date(feed[0].created_at).getTime();
      const age = Date.now() - newest;
      if (age < 30000) {
        setUrgencyPulse(true);
        if (urgencyTimerRef.current) clearTimeout(urgencyTimerRef.current);
        urgencyTimerRef.current = setTimeout(() => setUrgencyPulse(false), 30000 - age);
      }
    }
    return () => { if (urgencyTimerRef.current) clearTimeout(urgencyTimerRef.current); };
  }, [feed]);

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

  return (
    <>
      {/* Pill */}
      <div className="drop-pill-wrapper" style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top) + 130px)',
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
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          {!open ? (
            <>
              {'📣'} {hasContent ? `${totalCount} update${totalCount === 1 ? '' : 's'} tonight` : 'No updates tonight'}
            </>
          ) : (
            <span style={{
              fontSize: '13px',
              fontWeight: 700,
              letterSpacing: '0.5px',
              color: 'rgba(255,255,255,0.7)',
            }}>
              tonight
            </span>
          )}
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
              maxHeight: 'calc(70vh - env(safe-area-inset-bottom, 0px))',
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
              padding: '0 4px 8px',
            }}>
              {'📣'} THE DROP
            </div>

            {/* Unified feed — bar messages + events + live surges,
                chronological, each with a left stripe in the venue's
                current hue. Scrolls with iOS momentum, contained. */}
            <div className="drop-feed" style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              WebkitOverflowScrolling: 'touch',
              flex: 1,
            }}>
              {feed.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  color: 'rgba(255,255,255,0.3)',
                  fontSize: '13px',
                  padding: '20px 0',
                  fontFamily: FONT,
                }}>
                  No updates tonight
                </div>
              ) : (
                feed.map(item => (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (item.type === 'event' && item.raw) {
                        handleEventCardClick(item.raw as VenueEvent);
                      } else {
                        handleUpdateClick(item.venue_id);
                      }
                    }}
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderLeftWidth: '4px',
                      borderLeftColor: `hsl(${item.hue_degrees}, 70%, 55%)`,
                      borderRadius: '10px',
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: 'white',
                      fontFamily: FONT,
                      transition: 'background 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 700 }}>
                      <span style={{ fontSize: '16px' }}>{item.icon}</span>
                      <span>{item.venue_name}</span>
                      {item.type === 'surge' && (
                        <span style={{
                          fontSize: '10px',
                          color: `hsl(${item.hue_degrees}, 70%, 55%)`,
                          fontWeight: 800,
                          letterSpacing: '0.5px',
                        }}>
                          SURGING
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.8)', fontWeight: 500, lineHeight: 1.35 }}>
                      {item.body}
                    </div>
                    {item.subline && (
                      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>
                        {item.subline}
                      </div>
                    )}
                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>
                      {timeAgo(item.created_at)}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
