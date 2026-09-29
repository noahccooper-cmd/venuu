import { forwardRef } from 'react';
import { hapticLight } from '../../lib/haptics';
import { brandPartnerFor, eventColor, type SocialTheme } from '../../lib/socialTheme';
import { prefersReducedMotion } from '../../lib/socialGeo';
import type { SocialEvent } from '../../lib/socialTypes';
import { BrandMark } from './BrandMark';

const FONT = 'Satoshi, sans-serif';
// Two type sizes only: the date numeral, and everything else.
const NUMERAL = 26;
const TEXT = 13;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

interface SocialEventCardProps {
  event: SocialEvent;
  theme: SocialTheme;
  /** Linked highlight (card ↔ pin) — glows for ~1.5s. */
  highlighted: boolean;
  onTap: () => void;
}

export const SocialEventCard = forwardRef<HTMLButtonElement, SocialEventCardProps>(
  function SocialEventCard({ event, theme, highlighted, onTap }, ref) {
    const color = eventColor(theme, event);
    const brand = brandPartnerFor(theme, event);
    const start = new Date(event.start_time);
    const reduced = prefersReducedMotion();

    return (
      <button
        ref={ref}
        className="social-press"
        onClick={() => { hapticLight(); onTap(); }}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          width: '100%',
          textAlign: 'left',
          padding: '16px 16px 16px 18px',
          borderRadius: 12,
          background: 'var(--social-surface)',
          border: `1px solid ${highlighted ? color : 'var(--social-hairline)'}`,
          boxShadow: highlighted ? `0 0 20px -6px ${color}` : 'none',
          transition: reduced ? 'none' : 'border-color 250ms ease-out, box-shadow 250ms ease-out',
          cursor: 'pointer',
          overflow: 'hidden',
        }}
      >
        {/* One thin accent line — the only color on the card besides light. */}
        <span aria-hidden style={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 2, borderRadius: 1, background: color }} />

        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 40, flexShrink: 0 }}>
          <span className="social-num" style={{ fontFamily: FONT, fontSize: NUMERAL, fontWeight: 800, lineHeight: 1, color: 'var(--text-primary)' }}>
            {start.getDate()}
          </span>
          <span style={{ fontFamily: FONT, fontSize: TEXT, fontWeight: 700, letterSpacing: '0.12em', marginTop: 4, color: 'var(--text-secondary)' }}>
            {MONTHS[start.getMonth()]}
          </span>
        </span>

        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: FONT, fontSize: TEXT, fontWeight: 800, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: brand ? 88 : 0 }}>
            {event.title}
          </span>
          <span style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {event.external_venue_name ?? event.address}
          </span>
          <span className="social-num" style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)' }}>
            {timeOf(event.start_time)}
          </span>
        </span>

        {brand && (
          <span style={{ position: 'absolute', top: 14, right: 16 }}>
            <BrandMark name={brand.label} logo={brand.logo} size={TEXT} color="var(--text-muted)" />
          </span>
        )}
      </button>
    );
  },
);
