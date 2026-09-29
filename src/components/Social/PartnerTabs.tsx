import type { SocialPartner } from '../../lib/socialTheme';

const FONT = 'Satoshi, sans-serif';

interface PartnerTabsProps {
  partners: SocialPartner[];
  active: string | null;
  /** Tapping the active tab again returns to All (null). */
  onChange: (key: string | null) => void;
}

export function PartnerTabs({ partners, active, onChange }: PartnerTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Partners"
      style={{
        display: 'flex',
        gap: 8,
        padding: '12px 16px 8px',
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
            onClick={() => onChange(on ? null : p.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              flexShrink: 0,
              height: 34,
              padding: '0 12px',
              borderRadius: 17,
              border: `1px solid ${on ? p.color : 'var(--border-card)'}`,
              background: on ? `${p.color}1F` : 'transparent',
              cursor: 'pointer',
            }}
          >
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: p.color }} />
            <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: on ? 'var(--text-primary)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              {p.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
