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
  /** The sun's visible crest just outside the limb — the tap target at globe zoom. */
  crest: { x: number; y: number };
  button: { x: number; y: number };
}

/** Sun sits just inside the upper-right limb, so it rises from behind the
 *  planet like a sunrise; only its crest shows past the horizon. */
function sunGeometry(geo: GlobeGeometry, width: number, topInset: number): SunGeometry {
  const d = clamp(geo.r * 0.8, 110, 230);
  const inset = geo.r - d * 0.2;
  const sun = { x: geo.cx + DIR.x * inset, y: geo.cy + DIR.y * inset };
  const out = geo.r + d * 0.14;
  const crest = {
    x: clamp(geo.cx + DIR.x * out, 44, width - 44),
    y: Math.max(topInset + 44, geo.cy + DIR.y * out),
  };
  const button = { x: width - BUTTON_MARGIN - BUTTON / 2, y: topInset + BUTTON_MARGIN + BUTTON / 2 };
  return { d, sun, crest, button };
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
  onTap: () => void;
}

const CREST_TARGET = 72;

/**
 * The sun is the way into the presenter's World. At globe zoom this is an
 * invisible 72pt target over the sun's crest (no logo on the globe); as
 * zoom rises it condenses into a round corner button (≥44pt) showing the
 * presenter's logo, and stays there at every zoom.
 */
export function SunButton({ geo, zoom, width, topInset, colors, logo, name, shift, dragging, reduced, onTap }: SunButtonProps) {
  const t = sunMorph(zoom);
  const g = sunGeometry(geo, width, topInset);
  const x = lerp(g.crest.x, g.button.x, t) + shift.x * (1 - t);
  const y = lerp(g.crest.y, g.button.y, t) + shift.y * (1 - t);
  const size = lerp(CREST_TARGET, BUTTON, t);
  const move = reduced ? 'none' : dragging ? 'transform 150ms ease-out' : 'transform 350ms cubic-bezier(0.22, 1, 0.36, 1)';

  return (
    <button
      className="social-press"
      aria-label={`Enter ${name} World`}
      onClick={() => { hapticLight(); onTap(); }}
      style={{
        position: 'absolute', left: 0, top: 0, zIndex: 4,
        width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2,
        transform: `translate(${x}px, ${y}px)`,
        transition: move,
        padding: 0, cursor: 'pointer', borderRadius: '50%',
        display: 'grid', placeItems: 'center',
        // The disc appears only as the sun condenses into the button.
        background: t > 0 ? `radial-gradient(circle at 50% 45%, ${colors.core}, ${colors.mid})` : 'transparent',
        border: 'none',
        boxShadow: t > 0 ? `0 0 14px -2px ${colors.mid}` : 'none',
      }}
    >
      {t > 0 && (logo ? (
        <img src={logo} alt="" style={{ width: size * 0.78, height: size * 0.78, objectFit: 'contain', opacity: t }} />
      ) : (
        <span style={{ fontFamily: 'Satoshi, sans-serif', fontSize: 11, fontWeight: 800, color: '#1A1206', opacity: t }}>{name}</span>
      ))}
    </button>
  );
}
