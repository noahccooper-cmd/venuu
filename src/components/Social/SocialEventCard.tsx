import { forwardRef } from 'react';
import { brandPartnerFor, type SocialTheme } from '../../lib/socialTheme';
import { socialTimeLabel } from '../../lib/socialSections';
import { prefersReducedMotion } from '../../lib/socialGeo';
import type { SocialEvent } from '../../lib/socialTypes';
import { BrandMark } from './BrandMark';

const FONT = 'Satoshi, sans-serif';

interface SocialEventCardProps {
  event: SocialEvent;
  theme: SocialTheme;
  highlighted: boolean;
  onTap: () => void;
}

export const SocialEventCard = forwardRef<HTMLButtonElement, SocialEventCardProps>(
  function SocialEventCard({ event, theme, highlighted, onTap }, ref) {
    const color = theme.categoryColors[event.category];
    const brand = brandPartnerFor(theme, event);
    const reduced = prefersReducedMotion();

    return (
      <button
        ref={ref}
        onClick={onTap}
        style={{
          display: 'flex',
          alignItems: 'stretch',
          width: '100%',
          textAlign: 'left',
          padding: 0,
          borderRadius: 12,
          overflow: 'hidden',
          background: highlighted ? 'var(--bg-elevated)' : 'var(--bg-card)',
          border: `1px solid ${highlighted ? color : 'var(--border-subtle)'}`,
          transition: reduced ? 'none' : 'background 300ms ease, border-color 300ms ease',
          cursor: 'pointer',
        }}
      >
        <span aria-hidden style={{ width: 4, flexShrink: 0, background: color }} />
        <span style={{ flex: 1, minWidth: 0, padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>
            {socialTimeLabel(event)}
          </span>
          <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {event.title}
          </span>
          <span style={{ fontFamily: FONT, fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {event.external_venue_name ?? event.address}
          </span>
        </span>
        {brand && (
          <span style={{ display: 'flex', alignItems: 'center', paddingRight: 12, flexShrink: 0 }}>
            <BrandMark name={brand.label} logo={brand.logo} size={11} color="var(--text-secondary)" />
          </span>
        )}
      </button>
    );
  },
);
