import { hapticLight } from '../../lib/haptics';

/** Globe geometry in container px: disc center + radius. */
export interface GlobeGeometry { cx: number; cy: number; r: number }

interface SunBackdropProps {
  geo: GlobeGeometry;
  width: number;
  colors: { core: string; mid: string; corona: string };
  /** Parallax offset (px), opposite the drag. */
  shift: { x: number; y: number };
  dragging: boolean;
  reduced: boolean;
}

/** The sun scales with the globe so it always reads as rising from the
 *  rim — never an eclipse when the globe pulls back. */
function sunSize(width: number, r: number): number {
  return Math.max(96, Math.min(r * 0.9, width * 0.7, 280));
}

/** Where the sun sits: its center just below the globe's top limb, so it
 *  rises from behind the rim and the globe hides its lower part. */
function sunCenterY(geo: GlobeGeometry, d: number): number {
  return geo.cy - geo.r + d * 0.18;
}

/**
 * The sun disc + corona. Rendered BEHIND the globe canvas (the globe's
 * space is transparent), so the planet occludes it naturally.
 */
export function SunBackdrop({ geo, width, colors, shift, dragging, reduced }: SunBackdropProps) {
  const d = sunSize(width, geo.r);
  const cy = sunCenterY(geo, d);
  const move = reduced ? 'none' : dragging ? 'transform 150ms ease-out' : 'transform 350ms cubic-bezier(0.22, 1, 0.36, 1)';

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute', left: 0, top: 0, width: 0, height: 0,
        transform: `translate(${geo.cx + shift.x}px, ${cy + shift.y}px)`,
        transition: move,
        pointerEvents: 'none',
      }}
    >
      {/* Corona — the only ambient motion in Social: a very slow breath. */}
      <div
        className="social-breathe"
        style={{
          position: 'absolute', left: -d * 1.2, top: -d * 1.2, width: d * 2.4, height: d * 2.4, borderRadius: '50%',
          background: `radial-gradient(circle, ${colors.corona} 0%, ${colors.corona} 22%, rgba(253, 185, 19, 0.08) 45%, rgba(0, 0, 0, 0) 70%)`,
        }}
      />
      {/* Disc */}
      <div
        style={{
          position: 'absolute', left: -d / 2, top: -d / 2, width: d, height: d, borderRadius: '50%',
          background: `radial-gradient(circle at 50% 45%, ${colors.core} 0%, ${colors.core} 45%, ${colors.mid} 100%)`,
          boxShadow: `0 0 60px 12px ${colors.corona}`,
        }}
      />
    </div>
  );
}

interface SunLogoProps {
  geo: GlobeGeometry;
  width: number;
  logo: string | null;
  name: string;
  shift: { x: number; y: number };
  dragging: boolean;
  reduced: boolean;
  active: boolean;
  onTap: () => void;
}

/**
 * The presenter's logo sitting in the light above the horizon, plus the
 * tap target for the sun. Rendered ABOVE the canvas (it's over empty
 * space, not the globe).
 */
export function SunLogo({ geo, width, logo, name, shift, dragging, reduced, active, onTap }: SunLogoProps) {
  const d = sunSize(width, geo.r);
  const limbTop = geo.cy - geo.r;
  const capH = d * 0.32 + 16;          // visible sun above the rim, plus a little air
  const move = reduced ? 'none' : dragging ? 'transform 150ms ease-out' : 'transform 350ms cubic-bezier(0.22, 1, 0.36, 1)';
  const LOGO = Math.round(Math.max(40, Math.min(64, d * 0.24)));

  return (
    <button
      className="social-press"
      aria-label={active ? `Close ${name}` : `${name} events`}
      aria-pressed={active}
      onClick={() => { hapticLight(); onTap(); }}
      style={{
        position: 'absolute',
        left: geo.cx - d / 2,
        top: limbTop - capH,
        width: d,
        height: capH - 4,
        padding: 0,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        display: 'grid',
        placeItems: 'center',
        transform: `translate(${shift.x}px, ${shift.y}px)`,
        transition: move,
      }}
    >
      {logo ? (
        <img src={logo} alt={name} style={{ width: LOGO, height: LOGO, objectFit: 'contain', filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.35))' }} />
      ) : (
        <span style={{ fontFamily: 'Satoshi, sans-serif', fontSize: 15, fontWeight: 800, color: '#1A1206' }}>{name}</span>
      )}
    </button>
  );
}
