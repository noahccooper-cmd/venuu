import type { SocialPartner } from '../../lib/socialTheme';
import { Medallion } from './Medallion';

interface PartnerTabsProps {
  partners: SocialPartner[];
  active: string | null;
  /** Tapping the active medallion again returns to All (null). */
  onChange: (key: string | null) => void;
  /** Partners with their own page (hasPage) open it instead of filtering. */
  onOpenPage: (key: string) => void;
}

const SIZE = 56;

/** Partner medallions (same component as the globe), horizontally
 *  scrollable. Vertical padding leaves room for the selected lift + glow
 *  so nothing is clipped by the scroll container. */
export function PartnerTabs({ partners, active, onChange, onOpenPage }: PartnerTabsProps) {
  if (partners.length === 0) return null;
  return (
    <div
      role="tablist"
      aria-label="Partners"
      style={{
        display: 'flex',
        gap: 16,
        padding: '16px 16px 12px',
        overflowX: 'auto',
        overflowY: 'hidden',
        flexShrink: 0,
        scrollbarWidth: 'none',
      }}
    >
      {partners.map(p => {
        const on = p.key === active;
        return (
          <div
            key={p.key}
            role="tab"
            aria-selected={on}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '4px 2px', flexShrink: 0, width: SIZE + 20 }}
          >
            <Medallion
              partner={p}
              size={SIZE}
              selected={on}
              onTap={() => (p.hasPage ? onOpenPage(p.key) : onChange(on ? null : p.key))}
            />
            <span
              className="social-label"
              style={{
                fontFamily: 'Satoshi, sans-serif', textAlign: 'center', lineHeight: 1.2,
                letterSpacing: '0.06em', color: on ? p.color : 'var(--text-secondary)',
              }}
            >
              {p.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
