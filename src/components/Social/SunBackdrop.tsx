import { hapticLight } from '../../lib/haptics';

/** Globe geometry in container px: disc center + radius. */
export interface GlobeGeometry { cx: number; cy: number; r: number }

// Sunrise direction: up-right from the globe's center (60° above horizontal).
const DIR = { x: 0.5, y: -0.866 };
// Zoom band over which the sun shrinks into the corner button.
const MORPH_START = 3;
const MORPH_END = 4.5;
const BUTTON = 48;
const BUTTON_MARGIN = 16;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0 at globe zoom (sun behind the limb) → 1 once it's the corner button. */
export function sunMorph(zoom: number): number {
  return clamp((zoom - MORPH_START) / (MORPH_END - MORPH_START), 0, 1);
}

interface SunGeometry {
  d: number;
  sun: { x: number; y: number };
  logo: { x: number; y: number };
  button: { x: number; y: number };
}

/** Sun sits just inside the upper-right limb, so it rises from behind the
 *  planet like a sunrise; the logo floats in its light, clear of the globe. */
function sunGeometry(geo: GlobeGeometry, width: number, topInset: number): SunGeometry {
  const d = clamp(geo.r * 0.8, 110, 230);
  const inset = geo.r - d * 0.2;
  const sun = { x: geo.cx + DIR.x * inset, y: geo.cy + DIR.y * inset };
  const logo = {
    x: clamp(sun.x + DIR.x * d * 0.3, 40, width - 40),
    y: Math.max(topInset + 40, sun.y + DIR.y * d * 0.3),
  };
  const button = { x: width - BUTTON_MARGIN - BUTTON / 2, y: topInset + BUTTON_MARGIN + BUTTON / 2 };
  return { d, sun, logo, button };
}

interface SunProps {
  geo: GlobeGeometry;
  zoom: number;
  width: number;
  /** Top of the usable map area (below the app header). */
  topInset: number;
  colors: { core: string; mid: string; corona: string };
  /** Parallax offset (px), opposite the drag. */
  shift: { x: number; y: number };
  dragging: boolean;
  reduced: boolean;
}

/**
 * The sun disc + corona, rendered BEHIND the globe canvas (the globe's space
 * is transparent), so the planet occludes it. As zoom rises past ~3 it
 * converges on the corner and fades as the button takes over.
 */
export function SunBackdrop({ geo, zoom, width, topInset, colors, shift, dragging, reduced }: SunProps) {
  const t = sunMorph(zoom);
  if (t >= 1) return null;
  const g = sunGeometry(geo, width, topInset);
  const x = lerp(g.sun.x, g.button.x, t) + shift.x * (1 - t);
  const y = lerp(g.sun.y, g.button.y, t) + shift.y * (1 - t);
  const scale = 1 - 0.75 * t;
  const move = reduced ? 'none' : dragging ? 'transform 150ms ease-out' : 'transform 350ms cubic-bezier(0.22, 1, 0.36, 1)';
  const d = g.d;

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute', left: 0, top: 0, width: 0, height: 0,
        transform: `translate(${x}px, ${y}px) scale(${scale})`,
        transition: move,
        opacity: 1 - t,
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

interface SunButtonProps extends Omit<SunProps, 'colors'> {
  colors: { core: string; mid: string };
  logo: string | null;
  name: string;
  active: boolean;
  onTap: () => void;
}

/**
 * The presenter's logo. At globe zoom it floats in the sun's light above
 * the horizon; as zoom rises it moves into the top-right corner and becomes
 * a round sun button (≥44pt) that stays there at every zoom.
 */
export function SunButton({ geo, zoom, width, topInset, colors, logo, name, shift, dragging, reduced, active, onTap }: SunButtonProps) {
  const t = sunMorph(zoom);
  const g = sunGeometry(geo, width, topInset);
  const x = lerp(g.logo.x, g.button.x, t) + shift.x * (1 - t);
  const y = lerp(g.logo.y, g.button.y, t) + shift.y * (1 - t);
  const size = lerp(60, BUTTON, t);
  const move = reduced ? 'none' : dragging ? 'transform 150ms ease-out' : 'transform 350ms cubic-bezier(0.22, 1, 0.36, 1)';

  return (
    <button
      className="social-press"
      aria-label={active ? `Leave ${name} World` : `Enter ${name} World`}
      aria-pressed={active}
      onClick={() => { hapticLight(); onTap(); }}
      style={{
        position: 'absolute', left: 0, top: 0, zIndex: 4,
        width: Math.max(44, size), height: Math.max(44, size),
        marginLeft: -Math.max(44, size) / 2, marginTop: -Math.max(44, size) / 2,
        transform: `translate(${x}px, ${y}px)`,
        transition: move,
        padding: 0, cursor: 'pointer', borderRadius: '50%',
        display: 'grid', placeItems: 'center',
        // The disc behind the logo appears as the sun condenses into the button.
        background: t > 0 ? `radial-gradient(circle at 50% 45%, ${colors.core}, ${colors.mid})` : 'transparent',
        border: 'none',
        boxShadow: t > 0 ? `0 0 ${active ? 22 : 14}px -2px ${colors.mid}` : 'none',
        opacity: 1,
      }}
    >
      {logo ? (
        <img
          src={logo}
          alt=""
          style={{
            width: size * (t > 0 ? 0.78 : 1), height: size * (t > 0 ? 0.78 : 1), objectFit: 'contain',
            filter: t > 0 ? 'none' : 'drop-shadow(0 2px 8px rgba(0,0,0,0.35))',
          }}
        />
      ) : (
        <span style={{ fontFamily: 'Satoshi, sans-serif', fontSize: 11, fontWeight: 800, color: '#1A1206' }}>{name}</span>
      )}
    </button>
  );
}
