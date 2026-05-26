import { useState, useEffect } from 'react';

interface MomentNumberProps {
  /** The user's count of moments ever captured. Polish-6 uses
   *  placeholder #1. 49b computes from DB. */
  momentNumber: number;
  hueDegrees: number;
  hueLightness: number;
  /** True after the open sequence has reached the number's beat —
   *  triggers the scale-up bounce reveal */
  revealed: boolean;
}

export default function MomentNumber({
  momentNumber, hueDegrees, hueLightness, revealed,
}: MomentNumberProps) {
  const [glyphVisible, setGlyphVisible] = useState(false);

  // ✦ glyph fades in slightly AFTER the number lands (within
  // the reveal animation timing)
  useEffect(() => {
    if (revealed) {
      const t = setTimeout(() => setGlyphVisible(true), 280);
      return () => clearTimeout(t);
    } else {
      setGlyphVisible(false);
    }
  }, [revealed]);

  const hueColor = `hsl(${hueDegrees}, 85%, ${hueLightness}%)`;
  const hueGlowTight  = `hsla(${hueDegrees}, 90%, ${Math.min(80, hueLightness + 12)}%, 0.85)`;
  const hueGlowMid    = `hsla(${hueDegrees}, 90%, ${Math.min(80, hueLightness + 10)}%, 0.55)`;
  const hueGlowSoft   = `hsla(${hueDegrees}, 85%, ${hueLightness}%, 0.25)`;

  return (
    <div
      style={{
        // Positioned by parent (CameraFrame). This component just
        // renders the content with its own reveal animation.
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: '4px',
        opacity: revealed ? 1 : 0,
        transform: revealed ? 'scale(1)' : 'scale(0.85)',
        transformOrigin: 'right center',
        transition: 'opacity 400ms cubic-bezier(0.4, 0, 0.2, 1), transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        // ↑ The transform easing curve overshoots slightly (1.56)
        //   so the number "lands" with a subtle bounce. Mythological.
      }}
    >
      {/* ✦ glyph — the venuu mark, marks the number as venuu's */}
      <span
        style={{
          fontFamily: 'var(--font-cursive)',
          fontSize: '22px',
          color: hueColor,
          opacity: glyphVisible ? 0.85 : 0,
          transition: 'opacity 300ms ease-out, color 0.18s ease',
          textShadow: `
            0 0 6px ${hueGlowTight},
            0 0 14px ${hueGlowMid}
          `,
          marginRight: '2px',
          lineHeight: 1,
        }}
      >
        ✦
      </span>

      {/* The number itself — cursive, large, glowing, hue-matched */}
      <span
        style={{
          fontFamily: 'var(--font-cursive)',
          fontSize: '36px',
          fontWeight: 700,
          color: hueColor,
          letterSpacing: '0.5px',
          lineHeight: 1,
          // Triple-layer glow — the mythological treatment
          textShadow: `
            0 0 8px ${hueGlowTight},
            0 0 20px ${hueGlowMid},
            0 0 36px ${hueGlowSoft}
          `,
          transition: 'color 0.18s ease, text-shadow 0.18s ease',
        }}
      >
        #{momentNumber}
      </span>
    </div>
  );
}
