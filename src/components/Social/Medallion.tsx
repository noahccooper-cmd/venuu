import { Footprints, Moon, Store } from 'lucide-react';
import { hapticLight } from '../../lib/haptics';
import type { SocialPartner } from '../../lib/socialTheme';
import type { SocialCategory } from '../../lib/socialTypes';

// Venuu's own categories (not brands) get a plain icon, never a mark.
const CATEGORY_ICON: Record<SocialCategory, typeof Moon> = {
  run_club: Footprints,
  pop_up: Store,
  nightlife: Moon,
};

const FONT = 'Satoshi, sans-serif';

interface MedallionProps {
  partner: SocialPartner;
  size?: number;
  selected?: boolean;
  onTap?: () => void;
}

/**
 * Round partner mark inside a thin ring in the partner color: the official
 * logo file; else, for Venuu's own categories, a plain icon; else the
 * partner name as a stacked text wordmark. Never draws or imitates a logo.
 */
export function Medallion({ partner, size = 48, selected = false, onTap }: MedallionProps) {
  const words = partner.label.toUpperCase().split(/\s+/);
  const Icon = !partner.logo && !partner.match.brand && partner.match.category
    ? CATEGORY_ICON[partner.match.category]
    : null;
  const textSize = Math.max(7, Math.round(size / (words.length > 2 ? 6.5 : 5.5)));

  return (
    <button
      className="social-press"
      aria-label={partner.label}
      aria-pressed={selected}
      onClick={() => { hapticLight(); onTap?.(); }}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        padding: 0,
        display: 'grid',
        placeItems: 'center',
        background: 'var(--social-surface)',
        border: `1.5px solid ${partner.color}`,
        boxShadow: selected ? `0 0 16px -2px ${partner.color}` : `0 0 10px -6px ${partner.color}`,
        transform: selected ? 'translateY(-2px)' : 'none',
        transition: 'box-shadow 200ms ease-out, transform 200ms ease-out',
        cursor: 'pointer',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {partner.logo ? (
        <img src={partner.logo} alt="" style={{ width: '64%', height: '64%', objectFit: 'contain' }} />
      ) : Icon ? (
        <Icon size={Math.round(size * 0.4)} strokeWidth={1.75} color="var(--text-primary)" />
      ) : (
        <span
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            fontFamily: FONT, fontSize: textSize, fontWeight: 800, lineHeight: 1.05,
            letterSpacing: '0.04em', color: 'var(--text-primary)',
          }}
        >
          {words.map(w => <span key={w}>{w}</span>)}
        </span>
      )}
    </button>
  );
}
