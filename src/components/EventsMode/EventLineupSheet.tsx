import { useEffect, useMemo, useRef, useState } from 'react';
import { useEventsLineup, SECTION_LABELS, type LineupSection, type LineupEvent } from '../../hooks/useEventsLineup';
import { EventLineupCard } from './EventLineupCard';
import { pillRotationText } from '../../lib/eventDisplay';
import { hapticLight } from '../../lib/haptics';

const FONT = 'Satoshi, sans-serif';

export type SheetSnap = 'pill' | 'mid' | 'full';

interface EventLineupSheetProps {
  visible: boolean;
  city: string | null;
  userId: string | null;
  snap: SheetSnap;
  onSnapChange: (next: SheetSnap) => void;
  /** When the user taps a card, parent opens the full EventCard sheet. */
  onCardTap: (event: LineupEvent) => void;
  /** Event id that should be glowing (e.g. user just tapped its map orb). */
  glowingEventId: string | null;
}

/**
 * The lineup sheet — 3 snap states (pill / mid / full). Houses the
 * 3-section curated event lineup. When in pill state, shows a single
 * rotating event teaser at the bottom of the screen. When expanded,
 * shows ON TONIGHT / THIS WEEK / ON THE HORIZON sections with cards.
 */
export function EventLineupSheet({
  visible,
  city,
  userId,
  snap,
  onSnapChange,
  onCardTap,
  glowingEventId,
}: EventLineupSheetProps) {
  const { allCurated, bySection } = useEventsLineup(city);

  // Pill rotation state
  const [pillIndex, setPillIndex] = useState(0);
  const rotationCandidates = useMemo(() => {
    // Rotate through now_playing first, then this_week, then on_horizon
    return [...bySection.now_playing, ...bySection.this_week, ...bySection.on_horizon];
  }, [bySection]);

  useEffect(() => {
    if (snap !== 'pill' || rotationCandidates.length === 0) return;
    const interval = setInterval(() => {
      setPillIndex(i => (i + 1) % rotationCandidates.length);
    }, 4500);
    return () => clearInterval(interval);
  }, [snap, rotationCandidates.length]);

  // Reset rotation when set changes
  useEffect(() => { setPillIndex(0); }, [rotationCandidates.length]);

  // Auto-scroll to glowing card when sheet expands
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  useEffect(() => {
    if (snap === 'pill' || !glowingEventId) return;
    const el = cardRefs.current.get(glowingEventId);
    if (el) {
      setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 350); // wait for sheet to settle
    }
  }, [glowingEventId, snap]);

  // Drag-to-snap interaction
  const sheetRef = useRef<HTMLDivElement>(null);
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
    // Snap up: dy < -30 means dragged up ~30px+
    // Snap down: dy > 30 means dragged down ~30px+
    if (dy < -25) {
      if (snap === 'pill') onSnapChange('mid');
      else if (snap === 'mid') onSnapChange('full');
    } else if (dy > 25) {
      if (snap === 'full') onSnapChange('mid');
      else if (snap === 'mid') onSnapChange('pill');
    }
  };

  const handlePillTap = () => {
    if (snap === 'pill') {
      hapticLight();
      onSnapChange('mid');
    }
  };

  if (!visible) return null;

  // Snap heights — vh-based for consistent layout across devices
  const SHEET_HEIGHT: Record<SheetSnap, string> = {
    pill: '60px',
    mid:  '42vh',
    full: '78vh',
  };

  // Pill state (collapsed)
  if (snap === 'pill') {
    const currentEvt = rotationCandidates[pillIndex] || null;
    const totalEvents = rotationCandidates.length;
    const pillText = currentEvt
      ? pillRotationText(currentEvt)
      : totalEvents === 0
        ? '↑ Loading the lineup…'
        : '↑ See the lineup';

    return (
      <button
        type="button"
        onClick={handlePillTap}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          position: 'fixed',
          left: '50%',
          transform: 'translateX(-50%)',
          bottom: 'calc(64px + env(safe-area-inset-bottom, 0px) + 110px)', // above the EventsToggle
          zIndex: 44,
          height: 44,
          padding: '0 20px',
          maxWidth: '92vw',
          background: 'rgba(8, 8, 14, 0.85)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRadius: 999,
          border: '1px solid rgba(255, 200, 90, 0.18)',
          color: 'rgba(255, 255, 255, 0.9)',
          fontFamily: FONT,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.02em',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 16px rgba(255, 184, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
          transition: 'opacity 350ms ease, transform 350ms ease',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span key={pillIndex} style={{
          animation: 'eventPillFade 4500ms ease',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 0,
        }}>
          {(() => {
            // Gold-tint the arrow + date (events-world warmth); title stays
            // bright white. Falls back gracefully for the no-separator
            // loading / empty strings.
            const GOLD_TINT = 'rgba(255, 200, 120, 0.9)';
            const body = pillText.replace(/^↑\s*/, '');
            const sepIdx = body.indexOf(' · ');
            const title = sepIdx >= 0 ? body.slice(0, sepIdx) : body;
            const date = sepIdx >= 0 ? body.slice(sepIdx + 3) : '';
            return (
              <>
                <span style={{ color: GOLD_TINT, flexShrink: 0 }}>↑</span>
                <span style={{
                  color: 'rgba(255, 255, 255, 0.98)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>{title}</span>
                {date && (
                  <span style={{ color: GOLD_TINT, flexShrink: 0 }}>· {date}</span>
                )}
              </>
            );
          })()}
        </span>
      </button>
    );
  }

  // Expanded sheet state
  return (
    <>
      {/* Tap-outside scrim — only at FULL snap. At mid there is NO scrim
          so the top 58vh of the screen passes touches through to the map
          for pan/zoom. Full snap keeps the scrim for tap-to-collapse — sent
          straight to pill so an outside tap collapses in one tap, matching
          the map-tap-at-mid behavior. */}
      {snap === 'full' && (
        <div
          onClick={() => onSnapChange('pill')}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.25)',
            zIndex: 42,
            transition: 'opacity 350ms ease',
          }}
        />
      )}

      <div
        ref={sheetRef}
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          height: SHEET_HEIGHT[snap],
          zIndex: 43,
          background: 'linear-gradient(180deg, rgba(15, 15, 22, 0.96) 0%, rgba(10, 10, 18, 0.98) 100%)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 -8px 32px rgba(0, 0, 0, 0.5)',
          transition: 'height 350ms cubic-bezier(0.32, 0.72, 0, 1)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Drag handle */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            paddingTop: 8,
            paddingBottom: 12,
            cursor: 'grab',
            flexShrink: 0,
          }}
        >
          <div style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: 'rgba(255, 255, 255, 0.25)',
          }} />

          {/* COLLAPSE escape chip — only at full snap, gives a one-tap
              way back to the pill without dragging through mid. */}
          {snap === 'full' && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); hapticLight(); onSnapChange('pill'); }}
              style={{
                position: 'absolute',
                top: 10,
                right: 16,
                height: 28,
                padding: '0 12px',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 999,
                color: 'rgba(255, 255, 255, 0.7)',
                fontFamily: FONT,
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.16em',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              COLLAPSE
            </button>
          )}
        </div>

        {/* Scrollable lineup */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 18px 100px 18px',
          WebkitOverflowScrolling: 'touch',
        }}>
          {(['now_playing', 'this_week', 'on_horizon'] as LineupSection[]).map(section => {
            const events = bySection[section];
            if (events.length === 0) return null;
            return (
              <div key={section} style={{ marginBottom: 24 }}>
                <div style={{
                  position: 'sticky',
                  top: 0,
                  background: 'linear-gradient(180deg, rgba(15, 15, 22, 0.96) 0%, rgba(15, 15, 22, 0.86) 90%, rgba(15, 15, 22, 0) 100%)',
                  paddingTop: 4,
                  paddingBottom: 8,
                  zIndex: 1,
                  fontFamily: FONT,
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.22em',
                  color: 'rgba(255, 255, 255, 0.55)',
                  marginBottom: 8,
                }}>
                  {SECTION_LABELS[section]}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {events.map(evt => (
                    <div
                      key={evt.id}
                      ref={(el) => {
                        if (el) cardRefs.current.set(evt.id, el);
                        else cardRefs.current.delete(evt.id);
                      }}
                    >
                      <EventLineupCard
                        event={evt}
                        userId={userId}
                        isGlowing={glowingEventId === evt.id}
                        onTap={() => onCardTap(evt)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {allCurated.length === 0 && (
            <div style={{
              padding: '40px 20px',
              textAlign: 'center',
              fontFamily: FONT,
              color: 'rgba(255, 255, 255, 0.4)',
              fontSize: 13,
            }}>
              No events curated yet for this city.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
