import { useCallback } from 'react';
import { hapticMedium } from '../../lib/haptics';
import type { MapMode } from '../../lib/mapMode';

const FONT = 'Satoshi, sans-serif';

interface EventsToggleProps {
  mode: MapMode;
  onChange: (next: MapMode) => void;
  /** Hide the toggle entirely (e.g. when in plan mode or globe view). */
  hidden?: boolean;
  /** 1 = full opacity, 0.3 = dimmed, 0 = invisible (still rendered for layout). */
  dimLevel?: number;
}

/**
 * iOS-style toggle that flips venuu between vibe and events mode.
 * Sits bottom-center, just above the BottomNav. When the user taps,
 * the switch animates and broadcasts the new mode to the rest of the
 * app via App.tsx state + the venuu:map-mode event bus.
 *
 * Visual states:
 *   OFF (vibe):    track grey, knob left, label dim
 *   ON  (events):  track gold gradient, knob right, label glowing
 */
export function EventsToggle({ mode, onChange, hidden, dimLevel = 1 }: EventsToggleProps) {
  const isOn = mode === 'events';

  const handleTap = useCallback(() => {
    hapticMedium();
    onChange(isOn ? 'vibe' : 'events');
  }, [isOn, onChange]);

  if (hidden) return null;

  return (
    <button
      type="button"
      onClick={handleTap}
      aria-pressed={isOn}
      aria-label={isOn ? 'Switch to vibe mode' : 'Switch to events mode'}
      className="events-toggle"
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 'calc(64px + env(safe-area-inset-bottom, 0px) + 16px)',
        zIndex: 45, // above map, below sheets and modals
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        padding: 0,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        opacity: dimLevel,
        pointerEvents: dimLevel === 0 ? 'none' : 'auto',
        transition: 'opacity 300ms ease',
      }}
    >
      {/* Label */}
      <span
        style={{
          fontFamily: FONT,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: isOn ? '#FFB800' : 'rgba(255, 255, 255, 0.55)',
          textShadow: isOn
            ? '0 0 12px rgba(255, 184, 0, 0.6), 0 0 24px rgba(255, 184, 0, 0.3)'
            : 'none',
          transition: 'color 300ms ease, text-shadow 300ms ease',
          userSelect: 'none',
        }}
      >
        Events
      </span>

      {/* iOS-style switch */}
      <div
        style={{
          position: 'relative',
          width: 54,
          height: 30,
          borderRadius: 999,
          background: isOn
            ? 'linear-gradient(135deg, #FFB800 0%, #FF8200 100%)'
            : 'rgba(60, 60, 67, 0.85)',
          boxShadow: isOn
            ? '0 0 20px rgba(255, 184, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.18)'
            : 'inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 1px 4px rgba(0, 0, 0, 0.4)',
          transition: 'background 300ms cubic-bezier(0.32, 0.72, 0, 1), box-shadow 300ms ease',
        }}
      >
        {/* Knob */}
        <div
          style={{
            position: 'absolute',
            top: 2,
            left: isOn ? 26 : 2,
            width: 26,
            height: 26,
            borderRadius: '50%',
            background: '#FFFFFF',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.35), 0 0 0 0.5px rgba(0, 0, 0, 0.08)',
            transition: 'left 300ms cubic-bezier(0.32, 0.72, 0, 1)',
          }}
        />
      </div>
    </button>
  );
}
