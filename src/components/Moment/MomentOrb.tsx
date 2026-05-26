import { useMemo } from 'react';

export type OrbSize = 'profile' | 'venue-card';

interface MomentOrbProps {
  moment: {
    id: string;
    venue_id: string;
    venue_name: string;
    photo_url: string;
    hue_at_capture: number;
    developed_at: string;
    created_at: string;
    username?: string;
    /** User's personal moment number — engraved in JPEG +
     *  displayed in the orb's top-right pearl badge.
     *  Null on pre-migration legacy rows (badge hidden). */
    user_moment_number?: number | null;
  };
  size?: OrbSize;
  onTap: () => void;
}

/**
 * The trophy unit. A circular orb that shows the user's captured
 * photo with the hue they painted as a glow + frame ring. The
 * venue's first letter sits as a small monogram badge.
 *
 * Two states:
 *   - DEVELOPED (developed_at <= now): photo visible, full hue glow,
 *     tap opens full-screen view
 *   - LOCKED (developed_at > now): photo frosted, "8am" overlay,
 *     dimmer glow, tap still opens (so user sees the locked state)
 *
 * Two sizes:
 *   - profile: 76px, 4-per-row in profile grid, generous glow
 *   - venue-card: 56px, horizontal strip, subtler glow
 */
export default function MomentOrb({ moment, size = 'profile', onTap }: MomentOrbProps) {
  const isDeveloped = useMemo(() => {
    return new Date(moment.developed_at).getTime() <= Date.now();
  }, [moment.developed_at]);

  const venueLetter = (moment.venue_name?.[0] || '?').toUpperCase();

  const dimensions = size === 'profile'
    ? { orbSize: 76, badgeSize: 22, badgeFont: 11, momentBadgeFont: 13 }
    : { orbSize: 56, badgeSize: 18, badgeFont: 9,  momentBadgeFont: 10 };

  const { orbSize, badgeSize, badgeFont, momentBadgeFont } = dimensions;

  const hue = moment.hue_at_capture;
  const hueRing = `hsl(${hue}, 70%, 55%)`;
  const hueGlow = `hsla(${hue}, 80%, 60%, ${isDeveloped ? 0.55 : 0.28})`;
  const hueGlowInner = `hsla(${hue}, 90%, 65%, ${isDeveloped ? 0.9 : 0.5})`;

  return (
    <button
      onClick={onTap}
      aria-label={`Moment at ${moment.venue_name}`}
      style={{
        position: 'relative',
        width: orbSize,
        height: orbSize,
        padding: 0,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {/* Outer ring + glow — the hue radiating outward */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: `2px solid ${hueRing}`,
          boxShadow: `0 0 14px ${hueGlow}, 0 0 4px ${hueGlowInner}`,
          background: '#0a0a0a',
          overflow: 'hidden',
        }}
      >
        {/* The photo itself (or empty if no photo for some reason) */}
        {moment.photo_url && (
          <img
            src={moment.photo_url}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              filter: isDeveloped ? 'none' : 'blur(8px) brightness(0.6)',
              transition: 'filter 0.3s ease',
            }}
          />
        )}

        {/* Locked overlay: "8am" label visible through the frost */}
        {!isDeveloped && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.25)',
              color: 'rgba(255,255,255,0.95)',
              fontFamily: 'Satoshi, sans-serif',
              fontSize: size === 'profile' ? '11px' : '9px',
              fontWeight: 700,
              letterSpacing: '1px',
              textTransform: 'uppercase',
              textShadow: '0 1px 4px rgba(0,0,0,0.6)',
            }}
          >
            8AM
          </div>
        )}

        {/* Subtle inner highlight ring (premium glass feel) */}
        <div
          style={{
            position: 'absolute',
            inset: 1,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.06)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Venue-letter monogram badge — bottom right corner */}
      <div
        style={{
          position: 'absolute',
          bottom: -2,
          right: -2,
          width: badgeSize,
          height: badgeSize,
          borderRadius: '50%',
          background: '#0a0a0a',
          border: `1.5px solid ${hueRing}`,
          color: hueRing,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: badgeFont,
          fontFamily: 'Satoshi, sans-serif',
          fontWeight: 800,
          letterSpacing: '0.5px',
          boxShadow: `0 0 6px ${hueGlow}`,
        }}
      >
        {venueLetter}
      </div>

      {/* Moment number badge — pearlescent ✦#N, top-right corner.
          Mirrors the engraved JPEG's bottom-right number. The orb
          becomes a counted trophy: which moment in your journey
          this venue is. */}
      {moment.user_moment_number != null && (
        <div
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            display: 'flex',
            alignItems: 'baseline',
            gap: '1px',
            padding: '2px 6px',
            borderRadius: '12px',
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(6px)',
            border: '1px solid rgba(255, 248, 231, 0.25)',
            boxShadow: '0 0 8px rgba(255, 248, 231, 0.35)',
            fontFamily: 'var(--font-cursive)',
            lineHeight: 1,
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              fontSize: `${Math.max(8, momentBadgeFont - 3)}px`,
              color: 'var(--venuu-pearl)',
              textShadow: '0 0 4px rgba(255, 248, 231, 0.8)',
              marginRight: '1px',
            }}
          >
            ✦
          </span>
          <span
            style={{
              fontSize: `${momentBadgeFont}px`,
              fontWeight: 700,
              color: 'var(--venuu-pearl)',
              textShadow: `
                0 0 4px rgba(255, 248, 231, 0.9),
                0 0 10px rgba(255, 252, 239, 0.55)
              `,
              letterSpacing: '0.2px',
            }}
          >
            #{moment.user_moment_number}
          </span>
        </div>
      )}
    </button>
  );
}
