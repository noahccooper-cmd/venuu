import { useMemo } from 'react';
import { hapticLight, hapticTick } from '../../lib/haptics';
import { buildWindows, type EventWindow, type WindowChip } from '../../lib/eventWindows';
import type { VenueEvent } from '../../lib/types';

const FONT = 'Satoshi, sans-serif';
const GOLD = '#FFB800';
const ORANGE = '#FF8200';
const GOLD_GRADIENT = 'linear-gradient(135deg, #FFB800 0%, #FF8200 100%)';

/** Window order + display labels for the top rail. */
const WINDOW_ORDER: EventWindow[] = ['tonight', 'week', 'month', 'specials'];
const WINDOW_LABELS: Record<EventWindow, string> = {
  tonight: 'Tonight',
  week: 'This Week',
  month: 'This Month',
  specials: 'Specials',
};

interface EventScrubberProps {
  events: VenueEvent[];
  activeWindow: EventWindow;
  activeChipId: string;
  onSelect: (window: EventWindow, chip: WindowChip) => void;
  visible: boolean;
}

/**
 * Events-mode time scrubber, pinned to the top of the map just below
 * the app header. Two rows:
 *   • a segmented rail of time windows (Tonight / This Week / This
 *     Month / Specials)
 *   • a horizontally scrollable strip of chips for the active window
 *
 * Purely presentational — every chip and its lit-venue payload comes
 * from buildWindows(); selection is lifted to the parent, which feeds
 * the chosen chip's litVenueIds into the beacon effect so sweeping
 * days re-lights the map.
 */
export function EventScrubber({
  events,
  activeWindow,
  activeChipId,
  onSelect,
  visible,
}: EventScrubberProps) {
  const windows = useMemo(() => buildWindows(events), [events]);
  const activeChips = windows[activeWindow] ?? [];

  return (
    <div
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 56px)',
        left: 0,
        right: 0,
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(-16px)',
        pointerEvents: visible ? 'auto' : 'none',
        transition:
          'opacity 350ms cubic-bezier(0.32, 0.72, 0, 1), transform 350ms cubic-bezier(0.32, 0.72, 0, 1)',
      }}
    >
      {/* Top row — segmented window rail */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '6px',
          background: 'rgba(10, 10, 18, 0.72)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: 999,
          border: '1px solid rgba(255, 255, 255, 0.08)',
          maxWidth: '92vw',
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {WINDOW_ORDER.map(win => {
          const chips = windows[win] ?? [];
          if (chips.length === 0) return null;
          const isActive = win === activeWindow;
          return (
            <button
              key={win}
              type="button"
              onClick={() => {
                // Switching tabs → light tap; re-tapping the active tab → soft
                // tick, so every tap returns feedback.
                if (isActive) hapticTick();
                else hapticLight();
                onSelect(win, chips[0]);
              }}
              style={{
                padding: '7px 14px',
                borderRadius: 999,
                border: 'none',
                background: isActive ? GOLD_GRADIENT : 'rgba(255, 255, 255, 0.05)',
                color: isActive ? '#0A0A0F' : 'rgba(255, 255, 255, 0.7)',
                fontFamily: FONT,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.06em',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                WebkitTapHighlightColor: 'transparent',
                boxShadow: isActive
                  ? '0 0 16px rgba(255, 184, 0, 0.45)'
                  : 'inset 0 0 0 1px rgba(255, 255, 255, 0.05)',
                transition: 'background 250ms ease, color 250ms ease, transform 150ms ease',
              }}
            >
              {WINDOW_LABELS[win]}
            </button>
          );
        })}
      </div>

      {/* Second row — scrollable chips for the active window */}
      <div
        className="event-scrubber-chips"
        style={{
          display: 'flex',
          gap: 8,
          padding: '2px 12px',
          maxWidth: '96vw',
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {activeChips.map(chip => {
          const isActive = chip.id === activeChipId;
          const primaryColor = isActive
            ? '#0A0A0F'
            : chip.isTonight
            ? ORANGE
            : 'rgba(255, 255, 255, 0.92)';
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => {
                hapticLight();
                onSelect(activeWindow, chip);
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 2,
                minWidth: 64,
                padding: '8px 12px',
                borderRadius: 16,
                border: 'none',
                background: isActive
                  ? GOLD_GRADIENT
                  : 'rgba(10, 10, 18, 0.62)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                cursor: 'pointer',
                flexShrink: 0,
                WebkitTapHighlightColor: 'transparent',
                boxShadow: isActive
                  ? '0 0 22px rgba(255, 184, 0, 0.5)'
                  : 'inset 0 0 0 1px rgba(255, 255, 255, 0.08)',
                transition: 'background 250ms ease, box-shadow 250ms ease, transform 150ms ease',
              }}
            >
              <span
                style={{
                  fontFamily: FONT,
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: isActive ? 'rgba(10, 10, 15, 0.7)' : GOLD,
                }}
              >
                {chip.kicker}
              </span>
              <span
                style={{
                  fontFamily: FONT,
                  fontSize: 16,
                  fontWeight: 800,
                  lineHeight: 1.05,
                  color: primaryColor,
                }}
              >
                {chip.primary}
              </span>
              {chip.sub && (
                <span
                  style={{
                    fontFamily: FONT,
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    color: isActive ? 'rgba(10, 10, 15, 0.6)' : 'rgba(255, 255, 255, 0.45)',
                  }}
                >
                  {chip.sub}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
