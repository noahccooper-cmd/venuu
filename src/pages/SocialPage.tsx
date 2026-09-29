import { useCallback, useMemo, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { CityKey } from '../lib/constants';
import {
  SOCIAL_THEME, SOCIAL_CITY_LABEL, socialThemeVars, partnersForCity, partnerMatches, type SocialTheme,
} from '../lib/socialTheme';
import type { SocialEvent } from '../lib/socialTypes';
import { countThisWeek } from '../lib/socialSections';
import { useSocialEvents } from '../hooks/useSocialEvents';
import { SocialGlobe } from '../components/Social/SocialGlobe';
import { PresentedBy } from '../components/Social/BrandMark';
import { SocialCityMap, type MapFocus } from '../components/Social/SocialCityMap';
import { PartnerTabs } from '../components/Social/PartnerTabs';
import { PartnerAboutCard } from '../components/Social/PartnerAboutCard';
import { SocialEventList, type ListHighlight } from '../components/Social/SocialEventList';

const FONT = 'Satoshi, sans-serif';

interface SocialPageProps {
  /** True while the Social tab is the visible tab. */
  active: boolean;
}

/**
 * Social tab — see docs/social-tab-spec.md.
 * Screen 1 (world globe) → tap a city → Screen 2 (city map + list).
 * Theme is applied ONLY as CSS variables on this root element.
 */
export function SocialPage({ active }: SocialPageProps) {
  const theme = SOCIAL_THEME;
  const [city, setCity] = useState<CityKey | null>(null);

  const knoxville = useSocialEvents('knoxville');
  const tampa = useSocialEvents('tampa');
  const pinellas = useSocialEvents('st_petersburg');
  const eventsByCity: Record<CityKey, SocialEvent[]> = {
    knoxville: knoxville.events,
    tampa: tampa.events,
    st_petersburg: pinellas.events,
  };
  const counts = useMemo<Record<CityKey, number>>(() => ({
    knoxville: countThisWeek(knoxville.events),
    tampa: countThisWeek(tampa.events),
    st_petersburg: countThisWeek(pinellas.events),
  }), [knoxville.events, tampa.events, pinellas.events]);

  return (
    <div
      data-social-theme={theme.id}
      style={{
        ...socialThemeVars(theme, city),
        position: 'absolute',
        inset: 0,
        bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))',
        background: 'var(--bg-page)',
        display: 'flex',
        flexDirection: 'column',
      } as React.CSSProperties}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 16px',
          // Clears the app-level fixed Header — same offset as CommunityPage.
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)',
          borderBottom: '1px solid var(--border-hairline)',
          flexShrink: 0,
          minHeight: 20,
        }}
      >
        {city ? (
          <button
            onClick={() => setCity(null)}
            aria-label="Back to all cities"
            style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: -6, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <ChevronLeft size={20} color="var(--text-secondary)" />
            <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 800, color: 'var(--social-accent)', letterSpacing: '-0.01em' }}>
              {SOCIAL_CITY_LABEL[city]}
            </span>
          </button>
        ) : (
          <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            Social
          </span>
        )}
        <div style={{ flex: 1 }} />
        {theme.presentedBy && <PresentedBy name={theme.presentedBy.name} logo={theme.presentedBy.logo} />}
      </header>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {/* World stays mounted behind the city screen so "back" is instant. */}
        <div style={{ position: 'absolute', inset: 0, visibility: city ? 'hidden' : 'visible' }}>
          <SocialGlobe theme={theme} counts={counts} visible={active && !city} onCityChosen={setCity} />
        </div>
        {city && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <SocialCityScreen key={city} city={city} theme={theme} events={eventsByCity[city]} visible={active} />
          </div>
        )}
      </div>
    </div>
  );
}

interface SocialCityScreenProps {
  city: CityKey;
  theme: SocialTheme;
  events: SocialEvent[];
  visible: boolean;
}

/** Screen 2 — contained map, partner tabs, grouped list, all linked. */
function SocialCityScreen({ city, theme, events, visible }: SocialCityScreenProps) {
  const partners = useMemo(() => partnersForCity(theme, city), [theme, city]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [highlight, setHighlight] = useState<ListHighlight | null>(null);
  // Bumped per tap so repeat taps on the same card/pin re-fire.
  const nonce = useRef(0);

  const activePartner = partners.find(p => p.key === activeKey) ?? null;
  const listEvents = useMemo(
    () => (activePartner ? events.filter(e => partnerMatches(activePartner, e)) : events),
    [events, activePartner],
  );

  const handleCardTap = useCallback((ev: SocialEvent) => {
    setFocus({ id: ev.id, nonce: ++nonce.current });
  }, []);

  const handlePinTap = useCallback((id: string) => {
    // A dimmed pin's card is filtered out of the list — go back to All first.
    const ev = events.find(e => e.id === id);
    if (activePartner && ev && !partnerMatches(activePartner, ev)) setActiveKey(null);
    setHighlight({ id, nonce: ++nonce.current });
  }, [events, activePartner]);

  const cityLabel = SOCIAL_CITY_LABEL[city];
  const emptyText = activePartner
    ? `No ${activePartner.label} events in ${cityLabel} right now.`
    : `No events in ${cityLabel} right now.`;

  return (
    <>
      <SocialCityMap
        city={city}
        theme={theme}
        partners={partners}
        events={events}
        activePartner={activeKey}
        focus={focus}
        visible={visible}
        onPinTap={handlePinTap}
      />
      <PartnerTabs partners={partners} active={activeKey} onChange={setActiveKey} />
      {activePartner && <PartnerAboutCard partner={activePartner} />}
      <SocialEventList
        events={listEvents}
        theme={theme}
        highlight={highlight}
        emptyText={emptyText}
        onCardTap={handleCardTap}
      />
    </>
  );
}
