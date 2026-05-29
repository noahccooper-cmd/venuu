import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { hapticMedium, hapticLight } from '../../lib/haptics';
import { vibeColor, relativeTime, priceTierGlyph } from '../../lib/eventDisplay';
import { useHostHub } from '../../hooks/useHostHub';
import type { VenueEvent } from '../../lib/types';

const FONT = 'Satoshi, sans-serif';

interface HostHubCardProps {
  hubId: string | null;
  userId: string | null;
  visible: boolean;
  onClose: () => void;
  onCardTap?: (evt: VenueEvent) => void; // optional: open full EventCard
}

/**
 * The HostHubCard — bottom half-sheet that appears when user taps
 * a host venue pin in events mode. Shows the hub's identity (name,
 * subtitle, gold shimmer), the hero event (soonest, with ★ if
 * marquee), compact list of remaining events, and tenant venues
 * inside the hub.
 *
 * Replaces VenueSheet for hub venues in events mode. Vibe mode is
 * untouched.
 */
export function HostHubCard({ hubId, userId, visible, onClose, onCardTap }: HostHubCardProps) {
  const data = useHostHub(hubId);
  const [rsvpState, setRsvpState] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);

  // Drag-to-dismiss
  const dragStartY = useRef(0);
  const dragCurrentY = useRef(0);
  const isDragging = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    isDragging.current = true;
    dragStartY.current = e.touches[0].clientY;
    dragCurrentY.current = e.touches[0].clientY;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    dragCurrentY.current = e.touches[0].clientY;
  };
  const handleTouchEnd = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const dy = dragCurrentY.current - dragStartY.current;
    if (dy > 60) onClose();
  };

  // Load existing RSVPs for the user
  useEffect(() => {
    if (!userId || !data?.events?.length) return;
    let cancelled = false;
    (async () => {
      const eventIds = data.events.map(e => e.id);
      const { data: rsvps } = await supabase
        .from('event_rsvps')
        .select('event_id')
        .eq('user_id', userId)
        .in('event_id', eventIds);
      if (cancelled) return;
      const map: Record<string, boolean> = {};
      (rsvps ?? []).forEach(r => { map[r.event_id] = true; });
      setRsvpState(map);
    })();
    return () => { cancelled = true; };
  }, [userId, data?.events]);

  const handleRSVP = useCallback(async (eventId: string) => {
    if (!userId) { hapticLight(); return; }
    if (submitting) return;
    setSubmitting(eventId);
    hapticMedium();
    const wasGoing = rsvpState[eventId];
    setRsvpState(prev => ({ ...prev, [eventId]: !wasGoing }));
    if (wasGoing) {
      const { error } = await supabase.from('event_rsvps')
        .delete()
        .eq('user_id', userId)
        .eq('event_id', eventId);
      if (error) setRsvpState(prev => ({ ...prev, [eventId]: true }));
    } else {
      const { error } = await supabase.from('event_rsvps')
        .insert({ user_id: userId, event_id: eventId });
      if (error) setRsvpState(prev => ({ ...prev, [eventId]: false }));
    }
    setSubmitting(null);
  }, [userId, submitting, rsvpState]);

  if (!visible || !hubId) return null;

  const hub = data?.hub;
  const events = data?.events ?? [];
  const tenants = data?.tenants ?? [];
  const heroEvent = events[0];
  const restEvents = events.slice(1);

  return (
    <>
      {/* Backdrop — taps dismiss */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 48,
          background: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          opacity: visible ? 1 : 0,
          transition: 'opacity 350ms ease',
        }}
      />

      {/* The card */}
      <div
        style={{
          position: 'fixed',
          left: 0, right: 0, bottom: 0,
          height: '65vh',
          zIndex: 49,
          background: 'linear-gradient(180deg, rgba(15, 15, 22, 0.98) 0%, rgba(10, 10, 18, 1) 100%)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          borderTop: '1px solid rgba(255, 184, 0, 0.3)',
          boxShadow: '0 -12px 40px rgba(0, 0, 0, 0.6), 0 -2px 0 rgba(255, 184, 0, 0.4)',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 400ms cubic-bezier(0.32, 0.72, 0, 1)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: FONT,
        }}
      >
        {/* Drag handle + close */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            display: 'flex',
            justifyContent: 'center',
            paddingTop: 10,
            paddingBottom: 8,
            position: 'relative',
            flexShrink: 0,
          }}
        >
          <div style={{
            width: 40, height: 4, borderRadius: 2,
            background: 'rgba(255, 255, 255, 0.25)',
          }} />
          <button
            onClick={onClose}
            type="button"
            style={{
              position: 'absolute', top: 12, right: 18,
              width: 28, height: 28, borderRadius: 14,
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: 'rgba(255, 255, 255, 0.7)',
              fontSize: 14, fontWeight: 700,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Hub header — gold shimmer treatment */}
        <div style={{
          padding: '4px 24px 18px 24px',
          flexShrink: 0,
        }}>
          {/* venuu star + name */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4,
          }}>
            <span style={{
              fontSize: 18,
              color: '#FFB800',
              filter: 'drop-shadow(0 0 6px rgba(255, 184, 0, 0.5))',
            }}>✦</span>
            <span style={{
              fontSize: 22,
              fontWeight: 900,
              color: '#FFF',
              letterSpacing: '0.01em',
              textTransform: 'uppercase',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {hub?.name ?? 'Loading…'}
            </span>
          </div>
          {hub?.hub_subtitle && (
            <div style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.18em',
              color: 'rgba(255, 184, 0, 0.85)',
              marginLeft: 26,
            }}>
              {hub.hub_subtitle}
            </div>
          )}
          {/* Gold shimmer bar */}
          <div style={{
            marginTop: 14,
            height: 2,
            borderRadius: 1,
            background: 'linear-gradient(90deg, transparent 0%, rgba(255, 184, 0, 0.6) 30%, rgba(255, 215, 0, 0.9) 50%, rgba(255, 184, 0, 0.6) 70%, transparent 100%)',
            backgroundSize: '200% 100%',
            animation: 'hubShimmer 3s linear infinite',
          }} />
        </div>

        {/* Scrollable content */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '0 20px 40px 20px',
        }}>
          {/* Hero event (soonest) */}
          {heroEvent && (
            <HubHeroEvent
              event={heroEvent}
              isGoing={!!rsvpState[heroEvent.id]}
              submitting={submitting === heroEvent.id}
              onToggleGoing={() => handleRSVP(heroEvent.id)}
              onCardTap={() => onCardTap?.(heroEvent)}
            />
          )}

          {/* Remaining events */}
          {restEvents.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.22em',
                color: 'rgba(255, 255, 255, 0.4)',
                marginBottom: 10,
                paddingLeft: 4,
              }}>
                ALSO COMING UP · {restEvents.length} MORE
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {restEvents.map(evt => (
                  <HubListRow
                    key={evt.id}
                    event={evt}
                    isGoing={!!rsvpState[evt.id]}
                    submitting={submitting === evt.id}
                    onToggleGoing={() => handleRSVP(evt.id)}
                    onCardTap={() => onCardTap?.(evt)}
                  />
                ))}
              </div>
            </div>
          )}

          {events.length === 0 && !data?.loading && (
            <div style={{
              padding: '32px 16px',
              textAlign: 'center',
              color: 'rgba(255, 255, 255, 0.5)',
              fontSize: 13,
            }}>
              No upcoming events at this hub yet.
            </div>
          )}

          {/* Tenants section */}
          {tenants.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <div style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.22em',
                color: 'rgba(255, 255, 255, 0.4)',
                marginBottom: 10,
                paddingLeft: 4,
              }}>
                INSIDE {hub?.name.toUpperCase()}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {tenants.map(t => (
                  <div
                    key={t.id}
                    style={{
                      padding: '7px 12px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: 999,
                      color: 'rgba(255, 255, 255, 0.85)',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                    }}
                  >
                    {t.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* About */}
          {hub?.description && (
            <div style={{ marginTop: 24 }}>
              <div style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.22em',
                color: 'rgba(255, 255, 255, 0.4)',
                marginBottom: 10,
                paddingLeft: 4,
              }}>
                ABOUT
              </div>
              <div style={{
                fontSize: 13,
                color: 'rgba(255, 255, 255, 0.7)',
                lineHeight: 1.5,
                paddingLeft: 4,
              }}>
                {hub.description}
              </div>
              {hub.address && (
                <div style={{
                  marginTop: 8,
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'rgba(255, 255, 255, 0.45)',
                  letterSpacing: '0.04em',
                  paddingLeft: 4,
                }}>
                  {hub.address}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────

interface HubHeroEventProps {
  event: VenueEvent;
  isGoing: boolean;
  submitting: boolean;
  onToggleGoing: () => void;
  onCardTap?: () => void;
}

function HubHeroEvent({ event, isGoing, submitting, onToggleGoing, onCardTap }: HubHeroEventProps) {
  const color = vibeColor(event.vibe_tags);
  const isMarquee = (event as any).marquee;
  const goingCount = (event as any).going_count ?? 0;

  return (
    <div
      onClick={onCardTap}
      style={{
        position: 'relative',
        padding: '16px 18px',
        background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.02) 100%)',
        border: `1px solid ${color}44`,
        borderRadius: 18,
        marginTop: 8,
        cursor: onCardTap ? 'pointer' : 'default',
        overflow: 'hidden',
      }}
    >
      {/* Vibe color stripe top */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: 3,
        background: `linear-gradient(90deg, ${color}cc, ${color}66)`,
        boxShadow: `0 0 12px ${color}88`,
      }} />

      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {isMarquee && (
            <div style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.2em',
              color: '#FFB800',
              marginBottom: 6,
            }}>
              ★ MARQUEE
            </div>
          )}
          <div style={{
            fontSize: 17,
            fontWeight: 800,
            color: '#FFF',
            lineHeight: 1.2,
            marginBottom: 6,
            letterSpacing: '0.005em',
          }}>
            {event.title}
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 12, fontWeight: 700, letterSpacing: '0.08em',
          }}>
            <span style={{ color }}>{relativeTime(event.start_time)}</span>
            <span style={{ color: 'rgba(255, 255, 255, 0.25)' }}>·</span>
            <span style={{ color: 'rgba(255, 255, 255, 0.55)' }}>
              {priceTierGlyph((event as any).price_tier)}
            </span>
            {goingCount > 0 && (
              <>
                <span style={{ color: 'rgba(255, 255, 255, 0.25)' }}>·</span>
                <span style={{ color: 'rgba(255, 255, 255, 0.75)' }}>
                  {goingCount} going
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Going button */}
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleGoing(); }}
          type="button"
          disabled={submitting}
          style={{
            flex: 1,
            padding: '12px 16px',
            background: isGoing
              ? 'linear-gradient(135deg, #FFB800 0%, #FF8200 100%)'
              : 'rgba(255, 255, 255, 0.08)',
            color: isGoing ? '#0A0A0F' : '#FFF',
            fontFamily: FONT,
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: '0.12em',
            border: isGoing ? 'none' : '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: 12,
            cursor: 'pointer',
            opacity: submitting ? 0.6 : 1,
            transition: 'background 200ms ease, color 200ms ease',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {isGoing ? '✓ GOING' : "I'M GOING"}
        </button>
      </div>
    </div>
  );
}

interface HubListRowProps {
  event: VenueEvent;
  isGoing: boolean;
  submitting: boolean;
  onToggleGoing: () => void;
  onCardTap?: () => void;
}

function HubListRow({ event, isGoing, submitting, onToggleGoing, onCardTap }: HubListRowProps) {
  const color = vibeColor(event.vibe_tags);
  const isMarquee = (event as any).marquee;
  const goingCount = (event as any).going_count ?? 0;

  return (
    <div
      onClick={onCardTap}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px 10px 0',
        background: 'rgba(255, 255, 255, 0.025)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: 12,
        cursor: onCardTap ? 'pointer' : 'default',
      }}
    >
      {/* Vibe stripe */}
      <div style={{
        width: 3,
        alignSelf: 'stretch',
        background: color,
        borderRadius: '3px 0 0 3px',
      }} />

      <div style={{ flex: 1, minWidth: 0, paddingLeft: 8 }}>
        <div style={{
          fontSize: 13,
          fontWeight: 700,
          color: '#FFF',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {event.title}
          {isMarquee && (
            <span style={{ marginLeft: 6, color: '#FFB800', fontSize: 10 }}>★</span>
          )}
        </div>
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: 'rgba(255, 255, 255, 0.55)',
          marginTop: 2,
        }}>
          <span style={{ color }}>{relativeTime(event.start_time)}</span>
          {goingCount > 0 && (
            <span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>  ·  {goingCount} going</span>
          )}
        </div>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onToggleGoing(); }}
        type="button"
        disabled={submitting}
        style={{
          padding: '6px 10px',
          background: isGoing
            ? 'linear-gradient(135deg, #FFB800 0%, #FF8200 100%)'
            : 'rgba(255, 255, 255, 0.06)',
          color: isGoing ? '#0A0A0F' : 'rgba(255, 255, 255, 0.85)',
          fontFamily: FONT,
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.1em',
          border: isGoing ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 8,
          cursor: 'pointer',
          opacity: submitting ? 0.6 : 1,
          flexShrink: 0,
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {isGoing ? '✓' : 'GOING?'}
      </button>
    </div>
  );
}
