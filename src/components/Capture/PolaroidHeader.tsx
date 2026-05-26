import { useState, useEffect, useMemo } from 'react';

interface PolaroidHeaderProps {
  venueName: string;
  hueDegrees: number;
  hueLightness: number;  // 30-70 typical range
  /** Triggers re-typing animation when changed */
  triggerKey: number;
}

/**
 * The engraved Polaroid header — venue name, date, time, in cursive,
 * tinted in the active hue. Types itself on mount letter-by-letter.
 *
 * Phase 1: visual only (lives in the DOM, not yet composited into
 * the photo). Phase 2 (49b) will render this onto canvas for the
 * permanent engraving on the captured JPEG.
 */
export default function PolaroidHeader({
  venueName, hueDegrees, hueLightness, triggerKey,
}: PolaroidHeaderProps) {
  const lowercaseVenue = venueName.toLowerCase();

  // Date + time formatted on mount, not re-computed
  const dateStr = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric'
    }).toLowerCase();
  }, [triggerKey]);

  const timeStr = useMemo(() => {
    const d = new Date();
    const hours = d.getHours();
    const minutes = d.getMinutes();
    const ampm = hours >= 12 ? 'pm' : 'am';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')}${ampm}`;
  }, [triggerKey]);

  // Letter-by-letter type-in
  const [typedVenue, setTypedVenue] = useState('');
  const [typedDate, setTypedDate] = useState('');
  const [typedTime, setTypedTime] = useState('');

  useEffect(() => {
    // Reset
    setTypedVenue('');
    setTypedDate('');
    setTypedTime('');

    // Type venue name
    let i = 0;
    const v = setInterval(() => {
      i++;
      setTypedVenue(lowercaseVenue.slice(0, i));
      if (i >= lowercaseVenue.length) {
        clearInterval(v);
        // Then type date
        let j = 0;
        const d = setInterval(() => {
          j++;
          setTypedDate(dateStr.slice(0, j));
          if (j >= dateStr.length) {
            clearInterval(d);
            // Then type time
            let k = 0;
            const t = setInterval(() => {
              k++;
              setTypedTime(timeStr.slice(0, k));
              if (k >= timeStr.length) clearInterval(t);
            }, 30);
          }
        }, 25);
      }
    }, 50);

    return () => {
      clearInterval(v);
    };
  }, [lowercaseVenue, dateStr, timeStr, triggerKey]);

  const hueColor = `hsl(${hueDegrees}, 80%, ${hueLightness}%)`;
  const hueGlow  = `hsla(${hueDegrees}, 90%, ${Math.min(80, hueLightness + 10)}%, 0.5)`;

  return (
    <div
      style={{
        pointerEvents: 'none',
        fontFamily: "var(--font-cursive)",
        color: hueColor,
        textShadow: `0 0 16px ${hueGlow}, 0 1px 2px rgba(0,0,0,0.4)`,
        transition: 'color 0.18s ease, text-shadow 0.18s ease',
      }}
    >
      <div style={{
        fontSize: '30px',
        fontWeight: 600,
        letterSpacing: '0.3px',
        lineHeight: 1.1,
        marginTop: '8px',
      }}>
        {typedVenue}
        {typedVenue.length < lowercaseVenue.length && (
          <span style={{ opacity: 0.6 }}>|</span>
        )}
      </div>
      <div style={{
        fontSize: '17px',
        fontWeight: 500,
        letterSpacing: '0.3px',
        marginTop: '2px',
        opacity: 0.92,
      }}>
        {typedDate}
      </div>
      <div style={{
        fontSize: '13px',
        fontWeight: 400,
        letterSpacing: '0.4px',
        opacity: 0.78,
      }}>
        {typedTime}
      </div>
    </div>
  );
}
