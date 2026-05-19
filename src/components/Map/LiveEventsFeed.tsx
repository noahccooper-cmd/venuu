import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, envReady } from '../../lib/supabase';

/**
 * LiveEventsFeed
 *
 * Subscribes to public.live_events INSERT events for the active city
 * and renders up to two stacked toasts at the top of the map. Each
 * toast auto-dismisses 6 s after arrival; hovering a toast pauses
 * its timer; tapping fires onEventTap with the venue id (MapView
 * uses that to flyTo the venue) and dismisses immediately.
 *
 * For surge_first / surge_rapid_rise, the component also dispatches
 * a window-level `venuu-surge-celebration` event so the bubble for
 * the same venue can play its own one-off animation in sync.
 */

const TOAST_TTL_MS = 6_000;
const MAX_VISIBLE_TOASTS = 2;

type EventType = 'surge_first' | 'surge_rapid_rise' | 'social_pulse';

interface LiveEventPayload {
  venue_name?: string;
  message?: string;
  estimate?: number;
  prior_estimate?: number;
  pct_change?: number;
  capacity_pct?: number | null;
  tap_count?: number;
}

interface LiveEvent {
  id: string;
  event_type: EventType;
  venue_id: string;
  city: string;
  fired_at: string;
  payload: LiveEventPayload;
}

interface LiveEventsFeedProps {
  currentCity: string;
  onEventTap: (venueId: string) => void;
}

interface VisualSpec {
  background: string;
  border: string;
  boxShadow: string;
  textColor: string;
  headColor: string;
  icon: string;
  subhead: (p: LiveEventPayload) => string;
}

function visualFor(type: EventType): VisualSpec {
  switch (type) {
    case 'surge_first':
      return {
        background: 'linear-gradient(135deg, #0A0A0A 0%, #001A0E 100%)',
        border: '1px solid #1FE89A40',
        boxShadow: '0 0 24px #1FE89A55, 0 8px 24px rgba(0,0,0,0.6)',
        textColor: '#1FE89A',
        headColor: '#FFFFFF',
        icon: '⚡', // ⚡
        subhead: () => 'first surging tonight',
      };
    case 'surge_rapid_rise':
      return {
        background: 'linear-gradient(135deg, #1A0F05 0%, #2D1B0A 100%)',
        border: '1px solid #B8862F60',
        boxShadow: '0 0 16px #B8862F33, 0 8px 24px rgba(0,0,0,0.5)',
        textColor: '#FFF8E7',
        headColor: '#FFFFFF',
        icon: '↗', // ↗
        subhead: (p) =>
          p.pct_change !== undefined
            ? `rising fast · ${p.pct_change}% in 10m`
            : 'rising fast',
      };
    case 'social_pulse':
      return {
        background: 'linear-gradient(135deg, #1A0814 0%, #2A0F1F 100%)',
        border: '1px solid #C92A4540',
        boxShadow: '0 0 14px #E6395633, 0 8px 24px rgba(0,0,0,0.5)',
        textColor: '#F5D5DC',
        headColor: '#FFFFFF',
        icon: '👥', // 👥
        subhead: (p) =>
          p.tap_count !== undefined
            ? `${p.tap_count} just checked in`
            : 'people are arriving',
      };
  }
}

function isSurgeType(t: EventType): boolean {
  return t === 'surge_first' || t === 'surge_rapid_rise';
}

function LiveEventsFeedInner({ currentCity, onEventTap }: LiveEventsFeedProps) {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    setEvents(prev => prev.filter(e => e.id !== id));
    const t = timersRef.current.get(id);
    if (t !== undefined) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
  }, []);

  const startTimer = useCallback((id: string) => {
    const t = window.setTimeout(() => dismiss(id), TOAST_TTL_MS);
    timersRef.current.set(id, t);
  }, [dismiss]);

  const pauseTimer = useCallback((id: string) => {
    const t = timersRef.current.get(id);
    if (t !== undefined) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
  }, []);

  // Realtime subscription — INSERT-only, filtered to the active city
  // server-side via the realtime filter syntax.
  useEffect(() => {
    if (!envReady || !currentCity) return;

    const channel = supabase
      .channel(`live-events-${currentCity}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'live_events',
          filter: `city=eq.${currentCity}`,
        },
        (payload) => {
          const row = payload.new as LiveEvent;
          if (!row?.id) return;

          setEvents(prev => {
            // Dedup against fast-arriving duplicates and cap at MAX
            if (prev.some(e => e.id === row.id)) return prev;
            const next = [...prev, row];
            // Drop oldest if over the cap and immediately stop its timer
            while (next.length > MAX_VISIBLE_TOASTS) {
              const dropped = next.shift();
              if (dropped) {
                const t = timersRef.current.get(dropped.id);
                if (t !== undefined) {
                  clearTimeout(t);
                  timersRef.current.delete(dropped.id);
                }
              }
            }
            return next;
          });

          startTimer(row.id);

          // Sister-channel: tell any LiveVenueBubble for this venue to
          // play its own one-off celebration in sync.
          if (isSurgeType(row.event_type)) {
            window.dispatchEvent(
              new CustomEvent('venuu-surge-celebration', {
                detail: { venueId: row.venue_id, eventType: row.event_type },
              })
            );
          }
        }
      )
      .subscribe();

    return () => {
      // Snapshot the timer map so the cleanup is independent of state churn.
      const timers = timersRef.current;
      timers.forEach(t => clearTimeout(t));
      timers.clear();
      supabase.removeChannel(channel);
    };
  }, [currentCity, startTimer]);

  if (events.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 110,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        pointerEvents: 'none', // wrapper passes through; toasts opt back in
        width: 280,
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      <AnimatePresence initial={false}>
        {events.map(evt => {
          const v = visualFor(evt.event_type);
          const venueName = evt.payload.venue_name ?? 'A venue';
          const subhead = v.subhead(evt.payload);

          return (
            <motion.button
              key={evt.id}
              type="button"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12, transition: { duration: 0.35, ease: 'easeIn' } }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              onMouseEnter={() => pauseTimer(evt.id)}
              onMouseLeave={() => startTimer(evt.id)}
              onClick={() => {
                onEventTap(evt.venue_id);
                dismiss(evt.id);
              }}
              className={evt.event_type === 'surge_first' ? 'lef-surge-pulse' : undefined}
              style={{
                pointerEvents: 'auto',
                background: v.background,
                border: v.border,
                boxShadow: v.boxShadow,
                color: v.textColor,
                borderRadius: 16,
                padding: '12px 16px',
                width: '100%',
                cursor: 'pointer',
                fontFamily: 'Satoshi, sans-serif',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                backdropFilter: 'blur(6px)',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span
                aria-hidden
                style={{
                  fontSize: 20,
                  lineHeight: 1,
                  flexShrink: 0,
                  filter: 'drop-shadow(0 0 6px currentColor)',
                }}
              >
                {v.icon}
              </span>
              <span
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  minWidth: 0,
                  flex: 1,
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: v.headColor,
                    letterSpacing: 0.2,
                    lineHeight: 1.2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    width: '100%',
                  }}
                >
                  {venueName}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    marginTop: 2,
                    letterSpacing: 0.3,
                    lineHeight: 1.2,
                  }}
                >
                  {subhead}
                </span>
              </span>
            </motion.button>
          );
        })}
      </AnimatePresence>

      <style>{LEF_KEYFRAMES}</style>
    </div>
  );
}

const LEF_KEYFRAMES = `
@keyframes lef-surge-inner-glow {
  0%, 100% { box-shadow: 0 0 24px #1FE89A55, 0 8px 24px rgba(0,0,0,0.6); }
  50%      { box-shadow: 0 0 32px #1FE89A88, 0 8px 28px rgba(0,0,0,0.7); }
}
.lef-surge-pulse {
  animation: lef-surge-inner-glow 2.5s ease-in-out infinite;
}
`;

export const LiveEventsFeed = memo(LiveEventsFeedInner);
