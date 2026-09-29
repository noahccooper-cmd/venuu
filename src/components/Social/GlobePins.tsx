import { hapticLight } from '../../lib/haptics';
import type { CityKey } from '../../lib/constants';
import { SOCIAL_CITY_LABEL, type SocialPartner } from '../../lib/socialTheme';
import { Odometer } from './Odometer';
import { Medallion } from './Medallion';

const FONT = 'Satoshi, sans-serif';

/** Where a label sits relative to its dot, in px. Tampa, St. Pete and the
 *  run club meet within ~20 mi — a pixel apart at globe zoom — so their
 *  labels fan out on fixed leader lines instead of stacking. */
export interface PinOffset { dx: number; dy: number; align: 'center' | 'left' | 'right' }

export const CITY_OFFSETS: Record<CityKey, PinOffset> = {
  knoxville: { dx: 0, dy: -28, align: 'center' },
  tampa: { dx: 44, dy: -40, align: 'left' },
  st_petersburg: { dx: 44, dy: 40, align: 'left' },
};
export const PARTNER_OFFSET: PinOffset = { dx: -64, dy: 6, align: 'right' };

// Approximate footprint of a label / medallion at the end of its leader,
// used to test whether it would hang past the globe's limb.
export const LABEL_W = 110;
export const LABEL_H = 40;
export const MEDALLION_SIZE = 48;

/** Mirror an offset to the inward side: left↔right, above↔below. */
export function flipOffset(off: PinOffset): PinOffset {
  if (off.align === 'center') return { ...off, dy: -off.dy };
  return { dx: -off.dx, dy: off.dy, align: off.align === 'left' ? 'right' : 'left' };
}

function Leader({ dx, dy, color }: { dx: number; dy: number; color: string }) {
  const w = Math.abs(dx) + 2;
  const h = Math.abs(dy) + 2;
  return (
    <svg
      aria-hidden
      width={w}
      height={h}
      style={{ position: 'absolute', left: Math.min(0, dx) - 1, top: Math.min(0, dy) - 1, overflow: 'visible', pointerEvents: 'none' }}
    >
      <line
        x1={dx < 0 ? w - 1 : 1} y1={dy < 0 ? h - 1 : 1}
        x2={dx < 0 ? 1 : w - 1} y2={dy < 0 ? 1 : h - 1}
        stroke={color} strokeWidth={1} strokeOpacity={0.7}
      />
    </svg>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute', left: -3, top: -3, width: 6, height: 6, borderRadius: 3,
        background: color, boxShadow: `0 0 8px ${color}`,
      }}
    />
  );
}

/** Label box anchored at the leader's far end. */
function anchorStyle({ dx, dy, align }: PinOffset): React.CSSProperties {
  if (align === 'center') return { left: dx, top: dy, transform: dy < 0 ? 'translate(-50%, -100%)' : 'translate(-50%, 0)' };
  if (align === 'left') return { left: dx + 4, top: dy, transform: 'translateY(-50%)' };
  return { left: dx - 4, top: dy, transform: 'translate(-100%, -50%)' };
}

interface CityPinProps {
  city: CityKey;
  count: number;
  lit: boolean;
  reduced: boolean;
  /** Leader flipped to the inward side so the label stays on the globe. */
  flipped?: boolean;
  onTap: () => void;
}

export function CityPin({ city, count, lit, reduced, flipped = false, onTap }: CityPinProps) {
  const accent = `var(--social-accent-${city})`;
  const off = flipped ? flipOffset(CITY_OFFSETS[city]) : CITY_OFFSETS[city];
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, opacity: lit ? 1 : 0, transition: reduced ? 'none' : 'opacity 200ms ease-out' }}>
      <Dot color={accent} />
      <Leader dx={off.dx} dy={off.dy} color={accent} />
      <button
        className="social-press"
        onClick={() => { hapticLight(); onTap(); }}
        aria-label={`${SOCIAL_CITY_LABEL[city]}, ${count} this week`}
        style={{
          position: 'absolute', ...anchorStyle(off),
          display: 'flex', flexDirection: 'column',
          alignItems: off.align === 'center' ? 'center' : off.align === 'left' ? 'flex-start' : 'flex-end',
          gap: 2, padding: 8, background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
          textShadow: '0 1px 6px rgba(0,0,0,0.9)',
        }}
      >
        <span className="social-label" style={{ fontFamily: FONT, color: accent }}>
          {SOCIAL_CITY_LABEL[city]}
        </span>
        <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
          <Odometer value={count} run={lit} reduced={reduced} /> this week
        </span>
      </button>
    </div>
  );
}

interface PartnerPinProps {
  partner: SocialPartner;
  lit: boolean;
  reduced: boolean;
  flipped?: boolean;
  onTap: () => void;
}

export function PartnerPin({ partner, lit, reduced, flipped = false, onTap }: PartnerPinProps) {
  const off = flipped ? flipOffset(PARTNER_OFFSET) : PARTNER_OFFSET;
  const SIZE = MEDALLION_SIZE;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, opacity: lit ? 1 : 0, transition: reduced ? 'none' : 'opacity 200ms ease-out' }}>
      <Dot color={partner.color} />
      <Leader dx={off.dx} dy={off.dy} color={partner.color} />
      <div style={{ position: 'absolute', left: off.dx < 0 ? off.dx - SIZE : off.dx, top: off.dy - SIZE / 2 }}>
        <Medallion partner={partner} size={SIZE} onTap={onTap} />
      </div>
    </div>
  );
}
