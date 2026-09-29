import { useEffect, useMemo, useRef, useState } from 'react';
import type { SocialTheme } from '../../lib/socialTheme';
import type { SocialEvent } from '../../lib/socialTypes';
import { groupSocialEvents, SOCIAL_SECTION_LABELS, type SocialSection } from '../../lib/socialSections';
import { prefersReducedMotion } from '../../lib/socialGeo';
import { SocialEventCard } from './SocialEventCard';
import type { SocialLink } from './SocialCityMap';

const FONT = 'Satoshi, sans-serif';
const SECTIONS: SocialSection[] = ['today', 'this_week', 'upcoming'];
const LINK_MS = 1500;

interface SocialEventListProps {
  events: SocialEvent[];
  theme: SocialTheme;
  /** Card↔pin link — the card glows with its pin; pin taps also scroll here. */
  link: SocialLink | null;
  emptyText: string;
  onCardTap: (event: SocialEvent) => void;
}

export function SocialEventList({ events, theme, link, emptyText, onCardTap }: SocialEventListProps) {
  const groups = useMemo(() => groupSocialEvents(events), [events]);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const [lit, setLit] = useState<string | null>(null);

  useEffect(() => {
    if (!link) return;
    if (link.source === 'pin') {
      cardRefs.current.get(link.id)?.scrollIntoView({
        block: 'center',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }
    setLit(link.id);
    const t = window.setTimeout(() => setLit(null), LINK_MS);
    return () => window.clearTimeout(t);
  }, [link]);

  if (events.length === 0) {
    return (
      <div style={{ flex: 1, padding: '24px 16px', fontFamily: FONT, fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>
        {emptyText}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 16px 24px' }}>
      {SECTIONS.map(section => groups[section].length > 0 && (
        <section key={section} style={{ marginTop: 16 }}>
          <h3 className="social-label" style={{ margin: '0 0 8px', fontFamily: FONT, color: 'var(--text-muted)' }}>
            {SOCIAL_SECTION_LABELS[section]}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {groups[section].map(ev => (
              <SocialEventCard
                key={ev.id}
                ref={el => { if (el) cardRefs.current.set(ev.id, el); else cardRefs.current.delete(ev.id); }}
                event={ev}
                theme={theme}
                highlighted={lit === ev.id}
                onTap={() => onCardTap(ev)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
