import { memo, useEffect, useState } from 'react';
import { hapticLight } from '../../lib/haptics';

/**
 * VennyBar — a small centered pill that floats just below The Drop
 * pill on the tonight tab. Tapping it opens VennySheet.
 *
 * Design rationale: the map is the hero, The Drop is the revenue
 * surface, Venny is the conversation about both. None of the three
 * should dominate, so Venny is content-sized and centered — a peer
 * to The Drop rather than a chrome bar across the screen.
 *
 * Hidden while the cold-open intro is playing (App.tsx gates this)
 * and dimmed to 0.4 when the sheet is already open.
 */

interface VennyBarProps {
  onExpand: () => void;
  sheetOpen: boolean;
  /** Set true when Venny has produced a fresh response while the
   *  sheet was closed — surfaces a small orange dot indicator. */
  hasUnreadResponse?: boolean;
  /** Hide while at globe zoom — universe view, not metro view. */
  hidden?: boolean;
}

function VennyBarInner({ onExpand, sheetOpen, hasUnreadResponse, hidden }: VennyBarProps) {
  // Listen for the globe-zoom broadcast from TonightPage so Venny hides at
  // the universe view in unison with the other metro pills.
  const [isAtGlobe, setIsAtGlobe] = useState(false);
  useEffect(() => {
    const handler = (e: Event) => setIsAtGlobe((e as CustomEvent).detail.isAtGlobe);
    window.addEventListener('venuu:globe-state', handler as EventListener);
    return () => window.removeEventListener('venuu:globe-state', handler as EventListener);
  }, []);

  // Concealed = explicitly hidden by parent OR at globe zoom.
  const concealed = hidden || isAtGlobe;

  const handleTap = () => {
    hapticLight();
    onExpand();
  };

  return (
    <button
      type="button"
      onClick={handleTap}
      aria-label="Open Venny chat"
      className="venny-bar"
      style={{
        // Fixed because VennyBar lives at the App.tsx root rather than
        // inside TonightPage's positioned container — `fixed` gives us
        // a stable screen-relative anchor independent of any ancestor
        // layout. Pinned just below The Drop pill on the tonight tab.
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top) + 110px)',
        left: '50%',
        transform: concealed
          ? 'translate(-50%, -8px)'
          : 'translate(-50%, 0)',
        height: 38,
        maxWidth: 200,
        borderRadius: 19,
        background: 'rgba(15, 15, 22, 0.92)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 130, 0, 0.18)',
        padding: '0 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        // Sits above the map (~400) but below The Drop pill (600) so
        // the revenue surface always wins z-order conflicts.
        zIndex: 590,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
        opacity: concealed ? 0 : (sheetOpen ? 0.4 : 1),
        pointerEvents: concealed ? 'none' : 'auto',
        transition: 'opacity 280ms ease-out, transform 280ms ease-out',
      }}
    >
      {/* Sparkle ✨ — brand orange, 14px */}
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          flexShrink: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M8 1.2 L9.35 5.9 L14 7.25 L9.35 8.6 L8 13.3 L6.65 8.6 L2 7.25 L6.65 5.9 Z"
            fill="#FF8200"
          />
        </svg>
      </span>

      {/* Prompt copy — short, confident, mysterious */}
      <span
        style={{
          fontFamily: 'Satoshi, sans-serif',
          fontSize: 13,
          fontWeight: 500,
          color: 'rgba(255, 255, 255, 0.85)',
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap',
        }}
      >
        ask Venny
      </span>

      {/* Unread dot — appears only when there's a fresh response
       *  waiting and the sheet is closed. */}
      {hasUnreadResponse && !sheetOpen && (
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: '#FF8200',
            boxShadow: '0 0 6px rgba(255, 130, 0, 0.7)',
            flexShrink: 0,
          }}
        />
      )}

      {/* Right arrow — subtle orange chevron */}
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 12,
          height: 12,
          flexShrink: 0,
          opacity: 0.6,
        }}
      >
        <svg width="10" height="12" viewBox="0 0 10 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M3 2 L7 6 L3 10"
            stroke="#FF8200"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  );
}

export const VennyBar = memo(VennyBarInner);
