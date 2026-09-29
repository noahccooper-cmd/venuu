import { forwardRef } from 'react';
import { Navigation } from 'lucide-react';
import { hapticLight } from '../../lib/haptics';
import { brandPartnerFor, eventColor, SOCIAL_CITY_LABEL, type SocialTheme } from '../../lib/socialTheme';
import { socialCardTime } from '../../lib/socialSections';
import { openAppleMapsDirections } from '../../lib/socialLinks';
import { prefersReducedMotion } from '../../lib/socialGeo';
import type { SocialEvent } from '../../lib/socialTypes';
import { BrandMark } from './BrandMark';

const FONT = 'Satoshi, sans-serif';
// Three type sizes: title, date numeral, everything else.
const TITLE = 17;
const NUMERAL = 26;
const TEXT = 13;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

interface SocialEventCardProps {
  event: SocialEvent;
  theme: SocialTheme;
  /** Linked highlight (card ↔ pin) — glows for ~1.5s. */
  highlighted: boolean;
  /** Cross-city lists (partner view) tag each card with its city. */
  showCity?: boolean;
  onTap: () => void;
}

export const SocialEventCard = forwardRef<HTMLDivElement, SocialEventCardProps>(
  function SocialEventCard({ event, theme, highlighted, showCity = false, onTap }, ref) {
    const color = eventColor(theme, event);
    const brand = brandPartnerFor(theme, event);
    const start = new Date(event.start_time);
    const reduced = prefersReducedMotion();
    const place = brand?.locationNote ?? event.external_venue_name ?? event.address;
    const canDirect = !brand?.locationNote;

    return (
      <div
        ref={ref}
        className="social-card"
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '16px 16px 16px 18px',
          borderRadius: 12,
          background: 'var(--social-surface)',
          border: `1px solid ${highlighted ? color : 'var(--social-hairline)'}`,
          boxShadow: highlighted ? `0 0 20px -6px ${color}` : 'none',
          transition: reduced ? 'none' : 'border-color 250ms ease-out, box-shadow 250ms ease-out, transform 120ms ease-out',
          overflow: 'hidden',
        }}
      >
        {/* Whole-card tap target; Directions sits above it as its own button. */}
        <button
          className="social-card-hit"
          aria-label={`${event.title}, ${socialCardTime(event)}`}
          onClick={() => { hapticLight(); onTap(); }}
          style={{ position: 'absolute', inset: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        />

        {/* One thin accent line — the only color on the card besides light. */}
        <span aria-hidden style={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 2, borderRadius: 1, background: color }} />

        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 40, flexShrink: 0, pointerEvents: 'none' }}>
          <span className="social-num" style={{ fontFamily: FONT, fontSize: NUMERAL, fontWeight: 800, lineHeight: 1, color: 'var(--text-primary)' }}>
            {start.getDate()}
          </span>
          <span style={{ fontFamily: FONT, fontSize: TEXT, fontWeight: 700, letterSpacing: '0.12em', marginTop: 4, color: 'var(--text-secondary)' }}>
            {MONTHS[start.getMonth()]}
          </span>
        </span>

        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, pointerEvents: 'none' }}>
          {showCity && (
            <span style={{ fontFamily: FONT, fontSize: TEXT, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: `var(--social-accent-${event.city})` }}>
              {SOCIAL_CITY_LABEL[event.city]}
            </span>
          )}
          <span style={{ fontFamily: FONT, fontSize: TITLE, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: brand ? 32 : 0 }}>
            {event.title}
          </span>
          <span style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {place}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="social-num" style={{ fontFamily: FONT, fontSize: TEXT, color: 'var(--text-secondary)' }}>
              {socialCardTime(event)}
            </span>
            {canDirect && (
              <button
                className="social-press"
                onClick={(e) => { e.stopPropagation(); hapticLight(); openAppleMapsDirections(event.latitude, event.longitude, place); }}
                style={{
                  position: 'relative', zIndex: 1, pointerEvents: 'auto',
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 0',
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: FONT, fontSize: TEXT, fontWeight: 700, color: 'var(--text-primary)',
                }}
              >
                <Navigation size={12} strokeWidth={2} />
                Directions
              </button>
            )}
          </span>
        </span>

        {brand && (
          <span style={{ position: 'absolute', top: 12, right: 14, pointerEvents: 'none' }}>
            <BrandMark name={brand.label} logo={brand.logo} size={TEXT} color="var(--text-muted)" />
          </span>
        )}
      </div>
    );
  },
);
