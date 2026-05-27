/**
 * The closing receipt of a moment capture. After PaintCeremony
 * completes, this slides down from the top safe-area for 3
 * seconds reading "✦ moment N marked at {venue}" then fades.
 *
 * Pearlescent cream-gold to match the moment number system
 * (wordmark, JPEG engraving, ceremony declaration, orb badges).
 *
 * Non-blocking: map interaction is available during the toast.
 * The user can pan, tap, scroll — the toast just sits at top.
 *
 * Self-contained timing: parent passes momentNumber + venueName
 * + a key prop. Parent unmounts after the toast auto-dismisses.
 */

import { useEffect, useState } from 'react';
import { numberToCursiveWord } from '../../lib/numberToCursiveWord';

interface MomentToastProps {
  momentNumber: number;
  venueName: string;
  /** Fires when the toast animates out, parent should clear state */
  onDismissed: () => void;
}

const VISIBLE_MS = 3000;
const FADE_DURATION_MS = 500;

export default function MomentToast({
  momentNumber, venueName, onDismissed,
}: MomentToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Mount → fade-in next frame so the CSS transition catches
    const mountFrame = requestAnimationFrame(() => setVisible(true));

    // After VISIBLE_MS, start fade-out
    const fadeOut = setTimeout(() => setVisible(false), VISIBLE_MS);

    // After fade completes, tell parent to unmount
    const unmount = setTimeout(
      () => onDismissed(),
      VISIBLE_MS + FADE_DURATION_MS
    );

    return () => {
      cancelAnimationFrame(mountFrame);
      clearTimeout(fadeOut);
      clearTimeout(unmount);
    };
  }, [onDismissed]);

  const numberWord = numberToCursiveWord(momentNumber);
  const lowerVenue = venueName.toLowerCase();

  return (
    <div
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 16px)',
        left: '50%',
        transform: visible
          ? 'translate(-50%, 0) scale(1)'
          : 'translate(-50%, -40px) scale(0.96)',
        opacity: visible ? 1 : 0,
        transition: `opacity ${FADE_DURATION_MS}ms ease-out, transform ${FADE_DURATION_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
        zIndex: 8700,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 18px',
        borderRadius: '999px',
        background: 'rgba(0, 0, 0, 0.78)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 248, 231, 0.28)',
        boxShadow: `
          0 0 24px rgba(255, 248, 231, 0.25),
          0 8px 32px rgba(0, 0, 0, 0.45)
        `,
        fontFamily: 'var(--font-cursive)',
        whiteSpace: 'nowrap',
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      <span
        style={{
          fontSize: '20px',
          color: 'var(--venuu-pearl)',
          textShadow: '0 0 6px rgba(255, 248, 231, 0.9)',
          lineHeight: 1,
        }}
      >
        ✦
      </span>
      <span
        style={{
          fontSize: '20px',
          fontWeight: 600,
          color: 'var(--venuu-pearl)',
          textShadow: `
            0 0 4px rgba(255, 248, 231, 0.92),
            0 0 12px rgba(255, 252, 239, 0.55)
          `,
          letterSpacing: '0.3px',
          lineHeight: 1,
          animation: 'pearl-shimmer 5s ease-in-out infinite',
        }}
      >
        moment {numberWord} marked at {lowerVenue}
      </span>
    </div>
  );
}
