import { useEffect, useState } from 'react';

const FONT = 'Satoshi, sans-serif';

interface VenueToastProps {
  message: string | null;
}

/**
 * Floating toast that appears briefly when the user taps a venue pin
 * in events mode. Shows venue name + event count so they know which
 * venue they tapped before the sheet animates in.
 */
export function VenueToast({ message }: VenueToastProps) {
  const [visible, setVisible] = useState(false);
  const [displayed, setDisplayed] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    setDisplayed(message);
    setVisible(true);
    const fadeOut = setTimeout(() => setVisible(false), 1500);
    const clear = setTimeout(() => setDisplayed(null), 1800);
    return () => {
      clearTimeout(fadeOut);
      clearTimeout(clear);
    };
  }, [message]);

  if (!displayed) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 24px)',
        left: '50%',
        transform: visible
          ? 'translate(-50%, 0)'
          : 'translate(-50%, -20px)',
        opacity: visible ? 1 : 0,
        zIndex: 50,
        padding: '10px 16px',
        background: 'rgba(10, 10, 18, 0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 999,
        border: '1px solid rgba(255, 184, 0, 0.4)',
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4), 0 0 16px rgba(255, 184, 0, 0.15)',
        color: '#FFF',
        fontFamily: FONT,
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        transition: 'opacity 250ms ease, transform 350ms cubic-bezier(0.32, 0.72, 0, 1)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        maxWidth: '88vw',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {displayed}
    </div>
  );
}
