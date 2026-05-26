import { useState, useEffect, useMemo } from 'react';

interface PolaroidHeaderProps {
  venueName: string;
  hueDegrees: number;
  hueLightness: number;
  /** Triggers re-typing animation when changed */
  triggerKey: number;
}

/**
 * The engraved Polaroid header — ✦ + venue name + date/time,
 * in cursive, with hue + pearlescent dual-mark identity.
 *
 * Layout:
 *   ✦ sunspot              ← ✦ pearlescent, venue name hue, 34px
 *      may 25, 2026 · 11:47pm   ← timestamp hue, single 19px line
 *
 * The ✦ glyph here mirrors the ✦ in the bottom-right MomentNumber.
 * Both pearlescent cream-gold. Both the eternal venuu mark.
 * The text between them is the moment's hue. Two identities, one frame.
 *
 * Types itself on mount: glyph fades in, venue name types letter
 * by letter, then timestamp types letter by letter. Cinematic.
 */
export default function PolaroidHeader({
  venueName, hueDegrees, hueLightness, triggerKey,
}: PolaroidHeaderProps) {
  const lowercaseVenue = venueName.toLowerCase();

  // Date + time formatted on mount
  const timestampStr = useMemo(() => {
    const d = new Date();
    const dateStr = d.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric'
    }).toLowerCase();
    const hours = d.getHours();
    const minutes = d.getMinutes();
    const ampm = hours >= 12 ? 'pm' : 'am';
    const displayHours = hours % 12 || 12;
    const timeStr = `${displayHours}:${minutes.toString().padStart(2, '0')}${ampm}`;
    return `${dateStr} · ${timeStr}`;
  }, [triggerKey]);

  // Letter-by-letter type-in: glyph → venue → timestamp
  const [glyphVisible, setGlyphVisible] = useState(false);
  const [typedVenue, setTypedVenue] = useState('');
  const [typedTimestamp, setTypedTimestamp] = useState('');

  useEffect(() => {
    // Reset
    setGlyphVisible(false);
    setTypedVenue('');
    setTypedTimestamp('');

    // BEAT 1: glyph fades in immediately
    const t_glyph = setTimeout(() => setGlyphVisible(true), 50);

    // BEAT 2: venue name types letter by letter
    let venueChar = 0;
    const venueInterval = setInterval(() => {
      venueChar++;
      setTypedVenue(lowercaseVenue.slice(0, venueChar));
      if (venueChar >= lowercaseVenue.length) {
        clearInterval(venueInterval);

        // BEAT 3: timestamp types after venue completes
        let tsChar = 0;
        const tsInterval = setInterval(() => {
          tsChar++;
          setTypedTimestamp(timestampStr.slice(0, tsChar));
          if (tsChar >= timestampStr.length) {
            clearInterval(tsInterval);
          }
        }, 22);

        // Cleanup the inner interval if effect re-fires
        return () => clearInterval(tsInterval);
      }
    }, 48);

    return () => {
      clearTimeout(t_glyph);
      clearInterval(venueInterval);
    };
  }, [lowercaseVenue, timestampStr, triggerKey]);

  // Hue tokens (venue name + timestamp tint with the slider)
  const hueColor = `hsl(${hueDegrees}, 80%, ${hueLightness}%)`;
  const hueGlow  = `hsla(${hueDegrees}, 90%, ${Math.min(80, hueLightness + 10)}%, 0.5)`;

  // Pearlescent (✦ glyph — the eternal venuu mark, NOT hue-tinted)
  const PEARL_GLOW_TIGHT = 'rgba(255, 248, 231, 0.9)';
  const PEARL_GLOW_MID   = 'rgba(255, 252, 239, 0.55)';

  return (
    <div
      style={{
        pointerEvents: 'none',
        fontFamily: "var(--font-cursive)",
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
      }}
    >
      {/* Line 1: ✦ pearlescent glyph + venue name (hue) */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'baseline',
          gap: '8px',
          marginTop: '8px',
        }}
      >
        {/* ✦ glyph in pearlescent cream-gold — mirrors bottom-right
            moment number's glyph. The eternal venuu mark. */}
        <span
          style={{
            fontSize: '24px',
            color: 'var(--venuu-pearl)',
            opacity: glyphVisible ? 0.92 : 0,
            transition: 'opacity 320ms ease-out',
            textShadow: `
              0 0 6px ${PEARL_GLOW_TIGHT},
              0 0 14px ${PEARL_GLOW_MID}
            `,
            animation: 'pearl-shimmer 5s ease-in-out infinite',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ✦
        </span>

        {/* Venue name — elevated, hue-tinted, this is what makes
            the photo identifiable. The venue's mark. */}
        <span
          style={{
            fontSize: '34px',
            fontWeight: 600,
            letterSpacing: '0.5px',
            lineHeight: 1.1,
            color: hueColor,
            textShadow: `0 0 16px ${hueGlow}, 0 1px 2px rgba(0,0,0,0.4)`,
            transition: 'color 0.18s ease, text-shadow 0.18s ease',
          }}
        >
          {typedVenue}
          {typedVenue.length < lowercaseVenue.length && (
            <span style={{ opacity: 0.6 }}>|</span>
          )}
        </span>
      </div>

      {/* Line 2: timestamp — date · time on a single line,
          indented under the venue name (NOT under the glyph,
          which gives the typography a cleaner left-anchor) */}
      <div
        style={{
          fontSize: '19px',
          fontWeight: 500,
          letterSpacing: '0.4px',
          marginLeft: '32px',  // indent under venue name, past the ✦ glyph
          color: hueColor,
          opacity: 0.92,
          textShadow: `0 0 12px ${hueGlow}, 0 1px 2px rgba(0,0,0,0.4)`,
          transition: 'color 0.18s ease, text-shadow 0.18s ease',
        }}
      >
        {typedTimestamp}
      </div>
    </div>
  );
}
