import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { hapticMedium, hapticLight } from '../../lib/haptics';
import { vibeColor, relativeTime, priceTierGlyph } from '../../lib/eventDisplay';
import type { LineupEvent } from '../../hooks/useEventsLineup';

const FONT = 'Satoshi, sans-serif';

interface EventLineupCardProps {
  event: LineupEvent;
  userId: string | null;
  isGlowing: boolean;
  onTap: () => void;
}

/**
 * Single event card in the lineup sheet. Vibe-colored stripe on the
 * left, content in the middle, "I'M GOING" button on the right.
 * Tapping the card body opens the full EventCard sheet (handled by
 * parent via onTap). Tapping "I'M GOING" optimistically adds the
 * RSVP and updates the going_count.
 */
export function EventLineupCard({ event, userId, isGlowing, onTap }: EventLineupCardProps) {
  const color = vibeColor(event.vibe_tags);
  const [isGoing, setIsGoing] = useState(false);
  const [optimisticCount, setOptimisticCount] = useState(event.going_count);
  const [submitting, setSubmitting] = useState(false);

  // Check if user has already RSVP'd
  useEffect(() => {
    if (!userId) {
      setIsGoing(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('event_rsvps')
        .select('event_id')
        .eq('user_id', userId)
        .eq('event_id', event.id)
        .maybeSingle();
      if (!cancelled) setIsGoing(!!data);
    })();
    return () => { cancelled = true; };
  }, [userId, event.id]);

  // Keep optimistic count in sync with real count when realtime updates
  useEffect(() => {
    setOptimisticCount(event.going_count);
  }, [event.going_count]);

  const handleGoingToggle = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation(); // don't trigger card tap
    if (!userId) {
      hapticLight();
      // Defer: would prompt sign-in here
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    hapticMedium();

    const wasGoing = isGoing;
    // Optimistic flip
    setIsGoing(!wasGoing);
    setOptimisticCount(c => wasGoing ? Math.max(0, c - 1) : c + 1);

    if (wasGoing) {
      const { error } = await supabase
        .from('event_rsvps')
        .delete()
        .eq('user_id', userId)
        .eq('event_id', event.id);
      if (error) {
        // Revert
        setIsGoing(true);
        setOptimisticCount(c => c + 1);
        console.error('[rsvp] delete failed', error.message);
      }
    } else {
      const { error } = await supabase
        .from('event_rsvps')
        .insert({ user_id: userId, event_id: event.id });
      if (error) {
        // Revert
        setIsGoing(false);
        setOptimisticCount(c => Math.max(0, c - 1));
        console.error('[rsvp] insert failed', error.message);
      }
    }
    setSubmitting(false);
  }, [userId, event.id, isGoing, submitting]);

  return (
    <button
      type="button"
      onClick={onTap}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'stretch',
        gap: 12,
        padding: '12px 14px 12px 0',
        background: isGlowing
          ? 'linear-gradient(135deg, rgba(255, 184, 0, 0.18), rgba(255, 130, 0, 0.08))'
          : 'rgba(255, 255, 255, 0.04)',
        border: isGlowing
          ? '1px solid rgba(255, 184, 0, 0.5)'
          : '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: 14,
        cursor: 'pointer',
        fontFamily: FONT,
        textAlign: 'left',
        transition: 'background 600ms ease, border-color 600ms ease, transform 200ms ease',
        WebkitTapHighlightColor: 'transparent',
        width: '100%',
      }}
    >
      {/* Vibe color stripe (left edge) */}
      <div
        style={{
          width: 4,
          flexShrink: 0,
          background: color,
          borderRadius: '4px 0 0 4px',
          boxShadow: `0 0 8px ${color}66`,
        }}
      />

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div style={{
          fontSize: 15,
          fontWeight: 700,
          color: '#FFF',
          letterSpacing: '0.005em',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {event.title}
          {event.marquee && (
            <span style={{
              marginLeft: 6,
              fontSize: 10,
              color: '#FFB800',
              letterSpacing: '0.15em',
            }}>★</span>
          )}
        </div>
        <div style={{
          fontSize: 12,
          color: 'rgba(255, 255, 255, 0.55)',
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {event.host_name}
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
        }}>
          <span style={{ color }}>{relativeTime(event.start_time)}</span>
          <span style={{ color: 'rgba(255, 255, 255, 0.25)' }}>·</span>
          <span style={{ color: 'rgba(255, 255, 255, 0.45)' }}>{priceTierGlyph(event.price_tier)}</span>
          {optimisticCount > 0 && (
            <>
              <span style={{ color: 'rgba(255, 255, 255, 0.25)' }}>·</span>
              <span style={{ color: 'rgba(255, 255, 255, 0.65)' }}>{optimisticCount} going</span>
            </>
          )}
        </div>
      </div>

      {/* I'M GOING button */}
      <div
        onClick={handleGoingToggle}
        role="button"
        aria-label={isGoing ? 'Cancel RSVP' : 'RSVP'}
        style={{
          flexShrink: 0,
          alignSelf: 'center',
          padding: '7px 12px',
          borderRadius: 999,
          background: isGoing
            ? 'linear-gradient(135deg, #FFB800 0%, #FF8200 100%)'
            : 'rgba(255, 255, 255, 0.08)',
          color: isGoing ? '#0A0A0F' : 'rgba(255, 255, 255, 0.85)',
          fontFamily: FONT,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.08em',
          border: isGoing ? 'none' : '1px solid rgba(255, 255, 255, 0.15)',
          cursor: 'pointer',
          transition: 'background 200ms ease, color 200ms ease, transform 100ms ease',
          opacity: submitting ? 0.6 : 1,
          whiteSpace: 'nowrap',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {isGoing ? 'GOING' : "I'M GOING"}
      </div>
    </button>
  );
}
