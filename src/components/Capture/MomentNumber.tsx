import { useState, useEffect } from 'react';

interface MomentNumberProps {
  /** User's count of moments ever captured. Polish-6 uses
   *  placeholder #1. 49b computes from DB. */
  momentNumber: number;
  /** Hue props kept in signature for API stability with 49b,
   *  but the number does NOT tint with hue. The number is the
   *  user's permanent identity across all moments — pearlescent
   *  cream-gold, NEVER hue-tinted. The hue is the moment's mark.
   *  The number is YOURS. */
  hueDegrees: number;
  hueLightness: number;
  /** True after the open sequence has reached the number's beat */
  revealed: boolean;
}

export default function MomentNumber({
  momentNumber, revealed,
}: MomentNumberProps) {
  const [glyphVisible, setGlyphVisible] = useState(false);

  // ✦ glyph fades in slightly AFTER the number lands
  useEffect(() => {
    if (revealed) {
      const t = setTimeout(() => setGlyphVisible(true), 280);
      return () => clearTimeout(t);
    } else {
      setGlyphVisible(false);
    }
  }, [revealed]);

  // Pearlescent cream-gold — the eternal mark, NEVER tinted
  const PEARL = 'var(--venuu-pearl)';
  const PEARL_GLOW_TIGHT = 'rgba(255, 248, 231, 0.92)';
  const PEARL_GLOW_MID   = 'rgba(255, 252, 239, 0.65)';
  const PEARL_GLOW_SOFT  = 'rgba(255, 248, 231, 0.32)';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: '4px',
        opacity: revealed ? 1 : 0,
        transform: revealed ? 'scale(1)' : 'scale(0.85)',
        transformOrigin: 'right center',
        transition: 'opacity 400ms cubic-bezier(0.4, 0, 0.2, 1), transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
    >
      {/* ✦ glyph — the venuu mark in pearlescent cream-gold */}
      <span
        style={{
          fontFamily: 'var(--font-cursive)',
          fontSize: '22px',
          color: PEARL,
          opacity: glyphVisible ? 0.92 : 0,
          transition: 'opacity 300ms ease-out',
          textShadow: `
            0 0 6px ${PEARL_GLOW_TIGHT},
            0 0 14px ${PEARL_GLOW_MID}
          `,
          marginRight: '2px',
          lineHeight: 1,
          animation: 'pearl-shimmer 5s ease-in-out infinite',
        }}
      >
        ✦
      </span>

      {/* The number — cursive, pearlescent, the brightest element
          on the photo. This is the user's eternal identity. */}
      <span
        style={{
          fontFamily: 'var(--font-cursive)',
          fontSize: '38px',
          fontWeight: 700,
          color: PEARL,
          letterSpacing: '0.5px',
          lineHeight: 1,
          // Quadruple-layer warm glow — brightest element in the surface
          textShadow: `
            0 0 8px ${PEARL_GLOW_TIGHT},
            0 0 20px ${PEARL_GLOW_MID},
            0 0 36px ${PEARL_GLOW_SOFT},
            0 0 60px ${PEARL_GLOW_SOFT}
          `,
          // Subtle shimmer animation — the number is alive
          animation: 'pearl-shimmer 6s ease-in-out infinite',
        }}
      >
        #{momentNumber}
      </span>
    </div>
  );
}
