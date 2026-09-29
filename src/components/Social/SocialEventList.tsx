import { useEffect, useMemo, useRef, useState } from 'react';
import type { SocialTheme } from '../../lib/socialTheme';
import type { SocialEvent } from '../../lib/socialTypes';
import { sectionGroups, type SocialGroup } from '../../lib/socialSections';
import { prefersReducedMotion } from '../../lib/socialGeo';
import { SocialEventCard } from './SocialEventCard';
import type { SocialLink } from './SocialCityMap';

const FONT = 'Satoshi, sans-serif';
const LINK_MS = 1500;

interface SocialEventListProps {
  events: SocialEvent[];
  theme: SocialTheme;
  /** Card↔pin link — the card glows with its pin; pin taps also scroll here. */
  link: SocialLink | null;
  emptyText: string;
  /** Tag each card with its city (cross-city partner lists). */
  showCity?: boolean;
  /** Custom grouping (e.g. day headers); defaults to Today / This Week / Upcoming. */
  groups?: SocialGroup[];
  onCardTap: (event: SocialEvent) => void;
}

export function SocialEventList({ events, theme, link, emptyText, showCity = false, groups: customGroups, onCardTap }: SocialEventListProps) {
  const groups = useMemo(() => customGroups ?? sectionGroups(events), [customGroups, events]);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const [lit, setLit] = useState<string | null>(null);

  useEffect(() => {
    if (!link) return;
    if (link.source !== 'card') {
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
      {groups.map(group => (
        <section key={group.key} style={{ marginTop: 16 }}>
          <h3 className="social-label" style={{ margin: '0 0 8px', fontFamily: FONT, color: 'var(--text-muted)' }}>
            {group.label}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {group.events.map(ev => (
              <SocialEventCard
                key={ev.id}
                ref={el => { if (el) cardRefs.current.set(ev.id, el); else cardRefs.current.delete(ev.id); }}
                event={ev}
                theme={theme}
                highlighted={lit === ev.id}
                showCity={showCity}
                onTap={() => onCardTap(ev)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
