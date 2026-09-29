import { hapticLight } from '../../lib/haptics';
import type { SocialPartner } from '../../lib/socialTheme';

const FONT = 'Satoshi, sans-serif';

interface PartnerTabsProps {
  partners: SocialPartner[];
  active: string | null;
  /** Tapping the active tab again returns to All (null). */
  onChange: (key: string | null) => void;
}

export function PartnerTabs({ partners, active, onChange }: PartnerTabsProps) {
  if (partners.length === 0) return null;
  return (
    <div
      role="tablist"
      aria-label="Partners"
      style={{
        display: 'flex',
        gap: 8,
        padding: '16px 16px 8px',
        overflowX: 'auto',
        flexShrink: 0,
        scrollbarWidth: 'none',
      }}
    >
      {partners.map(p => {
        const on = p.key === active;
        return (
          <button
            key={p.key}
            role="tab"
            aria-selected={on}
            className="social-press"
            onClick={() => { hapticLight(); onChange(on ? null : p.key); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexShrink: 0,
              height: 32,
              padding: '0 16px',
              borderRadius: 16,
              background: 'transparent',
              // Color only as light: an edge + glow when selected, never a fill.
              border: `1px solid ${on ? p.color : 'var(--social-hairline)'}`,
              boxShadow: on ? `0 0 12px -4px ${p.color}` : 'none',
              transition: 'border-color 200ms ease-out, box-shadow 200ms ease-out',
              cursor: 'pointer',
            }}
          >
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: p.color, boxShadow: on ? `0 0 8px ${p.color}` : 'none' }} />
            <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: on ? 'var(--text-primary)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              {p.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
