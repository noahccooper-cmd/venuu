import { useEffect, useMemo, useRef, useState } from 'react';
import type { SocialTheme } from '../../lib/socialTheme';
import type { SocialEvent } from '../../lib/socialTypes';
import { groupSocialEvents, SOCIAL_SECTION_LABELS, type SocialSection } from '../../lib/socialSections';
import { prefersReducedMotion } from '../../lib/socialGeo';
import { SocialEventCard } from './SocialEventCard';

const FONT = 'Satoshi, sans-serif';
const SECTIONS: SocialSection[] = ['today', 'this_week', 'upcoming'];
const HIGHLIGHT_MS = 1500;

export interface ListHighlight { id: string; nonce: number }

interface SocialEventListProps {
  events: SocialEvent[];
  theme: SocialTheme;
  /** Pin tap → scroll to this card and highlight it briefly. */
  highlight: ListHighlight | null;
  emptyText: string;
  onCardTap: (event: SocialEvent) => void;
}

export function SocialEventList({ events, theme, highlight, emptyText, onCardTap }: SocialEventListProps) {
  const groups = useMemo(() => groupSocialEvents(events), [events]);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const [lit, setLit] = useState<string | null>(null);

  useEffect(() => {
    if (!highlight) return;
    const el = cardRefs.current.get(highlight.id);
    el?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    setLit(highlight.id);
    const t = window.setTimeout(() => setLit(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(t);
  }, [highlight]);

  if (events.length === 0) {
    return (
      <div style={{ flex: 1, padding: '24px 16px', fontFamily: FONT, fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center' }}>
        {emptyText}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 16px 24px' }}>
      {SECTIONS.map(section => groups[section].length > 0 && (
        <section key={section} style={{ marginTop: 10 }}>
          <h3 style={{ margin: '0 0 8px', fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
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
