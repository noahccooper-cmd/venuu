import { useId } from 'react';
import type { SocialEvent } from '../../lib/socialTypes';
import { coverKind, type CoverKind } from '../../lib/partnerWorld';

/**
 * An event's visual: its photo if it has one, else a procedural cover
 * (SVG, no stock images) drawn from the event's color family. Deterministic
 * per event id, so a card always looks the same.
 *
 * Parallax: the art is drawn slightly oversized and shifted by the CSS
 * variable --parallax (px) that the scrolling parent sets on the card.
 */

/** Small seeded PRNG (mulberry32) from a string. */
function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 400;
const H = 240;

function Art({ kind, seed, uid }: { kind: CoverKind; seed: string; uid: string }) {
  const r = rng(seed);
  const id = (s: string) => `${uid}-${s}`;

  if (kind === 'sunrise') {
    const horizon = H * (0.6 + r() * 0.1);
    const sx = W * (0.55 + r() * 0.25);
    const sr = H * (0.2 + r() * 0.06);
    return (
      <>
        <defs>
          <linearGradient id={id('sky')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#00A0AF" />
            <stop offset="0.75" stopColor="#1FB3BE" />
            <stop offset="1" stopColor="#7FD6D9" />
          </linearGradient>
          <radialGradient id={id('sun')} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#FFDD00" />
            <stop offset="0.7" stopColor="#FDB913" />
            <stop offset="1" stopColor="#FDB913" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={id('glow')} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#FFDD00" stopOpacity="0.45" />
            <stop offset="1" stopColor="#FFDD00" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill={`url(#${id('sky')})`} />
        <circle cx={sx} cy={horizon} r={sr * 2.6} fill={`url(#${id('glow')})`} />
        <circle cx={sx} cy={horizon} r={sr} fill={`url(#${id('sun')})`} />
        <rect y={horizon} width={W} height={H - horizon} fill="#007F8C" />
        <rect y={horizon} width={W} height={H - horizon} fill="#004C55" opacity="0.35" />
        <line x1="0" x2={W} y1={horizon} y2={horizon} stroke="#FFFFFF" strokeOpacity="0.7" strokeWidth="1" />
      </>
    );
  }

  if (kind === 'route') {
    const lines = 2 + Math.floor(r() * 2);
    const paths = Array.from({ length: lines }, () => {
      const y0 = H * (0.2 + r() * 0.6);
      const y3 = H * (0.2 + r() * 0.6);
      const c1 = [W * (0.2 + r() * 0.2), H * r()];
      const c2 = [W * (0.6 + r() * 0.2), H * r()];
      return `M -10 ${y0.toFixed(1)} C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${W + 10} ${y3.toFixed(1)}`;
    });
    return (
      <>
        <defs>
          <linearGradient id={id('bg')} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#123826" />
            <stop offset="1" stopColor="#07150E" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill={`url(#${id('bg')})`} />
        {paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="#2FBF71" strokeOpacity={i === 0 ? 0.75 : 0.35} strokeWidth={i === 0 ? 1.6 : 1}
            strokeLinecap="round" strokeDasharray={i === 0 ? undefined : '2 6'} />
        ))}
      </>
    );
  }

  if (kind === 'night') {
    const gx = 0.25 + r() * 0.5;
    const gy = 0.25 + r() * 0.4;
    return (
      <>
        <defs>
          <radialGradient id={id('bg')} cx={gx} cy={gy} r="0.9">
            <stop offset="0" stopColor="#8E1D24" />
            <stop offset="0.45" stopColor="#3A0A0E" />
            <stop offset="1" stopColor="#050303" />
          </radialGradient>
          <radialGradient id={id('glow')} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#E5484D" stopOpacity="0.55" />
            <stop offset="1" stopColor="#E5484D" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill={`url(#${id('bg')})`} />
        <circle cx={W * gx} cy={H * gy} r={H * 0.35} fill={`url(#${id('glow')})`} />
      </>
    );
  }

  if (kind === 'ivory') {
    const gx = 0.3 + r() * 0.4;
    return (
      <>
        <defs>
          <radialGradient id={id('bg')} cx={gx} cy="0.35" r="0.95">
            <stop offset="0" stopColor="#4A4336" />
            <stop offset="0.6" stopColor="#241F18" />
            <stop offset="1" stopColor="#12100C" />
          </radialGradient>
          <filter id={id('grain')} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={Math.floor(r() * 100)} />
            <feColorMatrix values="0 0 0 0 0.93  0 0 0 0 0.90  0 0 0 0 0.84  0 0 0 0.55 0" />
          </filter>
        </defs>
        <rect width={W} height={H} fill={`url(#${id('bg')})`} />
        <rect width={W} height={H} filter={`url(#${id('grain')})`} opacity="0.35" />
      </>
    );
  }

  // community — neutral gray with one soft diagonal light
  const a = r();
  return (
    <>
      <defs>
        <linearGradient id={id('bg')} x1={a} y1="0" x2={1 - a} y2="1">
          <stop offset="0" stopColor="#3A3A40" />
          <stop offset="1" stopColor="#151517" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${id('bg')})`} />
    </>
  );
}

interface EventCoverProps {
  event: SocialEvent;
  /** Load eagerly (visible / next cards) or lazily (the rest). */
  eager?: boolean;
  /** Parallax direction: carousels scroll sideways, the feed vertically. */
  axis?: 'x' | 'y';
}

export function EventCover({ event, eager = false, axis = 'x' }: EventCoverProps) {
  const uid = useId().replace(/:/g, '');
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 'inherit' }}>
      <div
        style={{
          position: 'absolute', inset: axis === 'x' ? '0 -8%' : '-8% 0',
          transform: axis === 'x' ? 'translateX(var(--parallax, 0px))' : 'translateY(var(--parallax, 0px))',
          willChange: 'transform',
        }}
      >
        {event.photo_url ? (
          <img
            src={event.photo_url}
            alt=""
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%', display: 'block' }}>
            <Art kind={coverKind(event)} seed={event.id} uid={uid} />
          </svg>
        )}
      </div>
    </div>
  );
}
