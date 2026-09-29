import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Plus } from 'lucide-react';
import type { CityKey } from '../lib/constants';
import {
  SOCIAL_THEME, SOCIAL_CITY_LABEL, socialThemeVars, partnersWithEvents, partnerMatches, type SocialTheme,
} from '../lib/socialTheme';
import type { SocialEvent } from '../lib/socialTypes';
import { countThisWeek, groupSocialDays } from '../lib/socialSections';
import { prefersReducedMotion } from '../lib/socialGeo';
import { useSocialEvents } from '../hooks/useSocialEvents';
import { SocialGlobe } from '../components/Social/SocialGlobe';
import { PresentedBy } from '../components/Social/BrandMark';
import { SocialCityMap, type SocialLink } from '../components/Social/SocialCityMap';
import { PartnerTabs } from '../components/Social/PartnerTabs';
import { PartnerAboutCard } from '../components/Social/PartnerAboutCard';
import { SocialEventList } from '../components/Social/SocialEventList';
import { hapticLight } from '../lib/haptics';
import { RunClubPage } from '../components/Social/RunClubPage';
import { Medallion } from '../components/Social/Medallion';
import { HostSheet } from '../components/Social/HostSheet';
import { HOST_DEMO_ENABLED } from '../lib/socialDemoStore';
import '../components/Social/social.css';

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
  // Partner to pre-select when a city opens from a globe medallion.
  const [entryPartner, setEntryPartner] = useState<string | null>(null);
  // A partner's own page (e.g. the run club), over world or city.
  const [partnerPage, setPartnerPage] = useState<string | null>(null);
  // World-level partner view (the sun → the presenting partner).
  const [worldPartner, setWorldPartner] = useState<string | null>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [worldH, setWorldH] = useState(0);
  useEffect(() => {
    const el = worldRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWorldH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const sheetHeight = Math.round(worldH * 0.5);
  const reduced = prefersReducedMotion();

  // Replay the globe arrival each time the Social tab opens.
  const [arrivalKey, setArrivalKey] = useState(0);
  useEffect(() => {
    if (active) setArrivalKey(k => k + 1);
  }, [active]);

  const knoxville = useSocialEvents('knoxville');
  const tampa = useSocialEvents('tampa');
  const pinellas = useSocialEvents('st_petersburg');
  const eventsByCity: Record<CityKey, SocialEvent[]> = {
    knoxville: knoxville.events,
    tampa: tampa.events,
    st_petersburg: pinellas.events,
  };
  const allEvents = useMemo(
    () => [...knoxville.events, ...tampa.events, ...pinellas.events],
    [knoxville.events, tampa.events, pinellas.events],
  );
  // Globe medallions: partners with a pinned home and ≥1 upcoming event.
  const pinnedPartners = useMemo(
    () => partnersWithEvents(theme, allEvents).filter(p => p.home),
    [theme, allEvents],
  );
  const partnerView = useMemo(() => {
    const partner = theme.partners.find(p => p.key === worldPartner);
    if (!partner) return null;
    const events = allEvents
      .filter(e => partnerMatches(partner, e))
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    return { partner, events };
  }, [theme, worldPartner, allEvents]);
  const pagePartner = theme.partners.find(p => p.key === partnerPage) ?? null;
  const pageRuns = useMemo(
    () => (pagePartner
      ? allEvents.filter(e => partnerMatches(pagePartner, e)).sort((a, b) => a.start_time.localeCompare(b.start_time))
      : []),
    [pagePartner, allEvents],
  );
  const partnerGroups = useMemo(() => (partnerView ? groupSocialDays(partnerView.events) : []), [partnerView]);

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
        background: 'var(--social-bg)',
        display: 'flex',
        flexDirection: 'column',
      } as React.CSSProperties}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '16px',
          // Clears the app-level fixed Header — same offset as CommunityPage.
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)',
          borderBottom: '1px solid var(--social-hairline)',
          flexShrink: 0,
          minHeight: 20,
        }}
      >
        {pagePartner ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="social-press"
              onClick={() => { hapticLight(); setPartnerPage(null); }}
              aria-label="Back"
              style={{ display: 'flex', alignItems: 'center', marginLeft: -6, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              <ChevronLeft size={20} color="var(--text-secondary)" />
            </button>
            <Medallion partner={pagePartner} size={32} />
            <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 800, color: pagePartner.color, letterSpacing: '-0.01em' }}>
              {pagePartner.label}
            </span>
          </div>
        ) : city ? (
          <button
            className="social-press"
            onClick={() => { hapticLight(); setCity(null); }}
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
        <div ref={worldRef} style={{ position: 'absolute', inset: 0, visibility: city ? 'hidden' : 'visible', overflow: 'hidden' }}>
          <SocialGlobe
            theme={theme}
            counts={counts}
            pinnedPartners={pinnedPartners}
            partnerView={partnerView}
            sheetHeight={sheetHeight}
            onSunTap={() => setWorldPartner(k => (k ? null : theme.presentedBy?.partnerKey ?? null))}
            visible={active && !city}
            arrivalKey={arrivalKey}
            onCityChosen={c => { setEntryPartner(null); setCity(c); }}
            onPartnerTap={key => setPartnerPage(key)}
          />

          {/* Partner sheet: About card + every future event for the partner. */}
          <div
            aria-hidden={!partnerView}
            style={{
              position: 'absolute', left: 0, right: 0, bottom: 0, height: sheetHeight,
              background: 'var(--social-bg)',
              borderTop: '1px solid var(--social-hairline)',
              borderRadius: '16px 16px 0 0',
              overflowY: 'auto',
              paddingTop: 16,
              transform: partnerView ? 'translateY(0)' : 'translateY(100%)',
              transition: reduced ? 'none' : 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1)',
              pointerEvents: partnerView ? 'auto' : 'none',
            }}
          >
            {partnerView && (
              <>
                <PartnerAboutCard partner={partnerView.partner} />
                <SocialEventList
                  events={partnerView.events}
                  groups={partnerGroups}
                  theme={theme}
                  link={null}
                  showCity
                  emptyText={`No upcoming ${partnerView.partner.label} events.`}
                  onCardTap={ev => { setEntryPartner(partnerView.partner.key); setCity(ev.city); }}
                />
              </>
            )}
          </div>
        </div>
        {city && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <SocialCityScreen key={city} city={city} theme={theme} events={eventsByCity[city]} visible={active} initialPartner={entryPartner} onOpenPartnerPage={setPartnerPage} />
          </div>
        )}
        {pagePartner && (
          <RunClubPage partner={pagePartner} runs={pageRuns} />
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
  initialPartner: string | null;
  onOpenPartnerPage: (key: string) => void;
}

/** Screen 2 — contained map, partner tabs, grouped list, all linked. */
function SocialCityScreen({ city, theme, events, visible, initialPartner, onOpenPartnerPage }: SocialCityScreenProps) {
  // Only partners with ≥1 upcoming event in this city get a tile.
  const partners = useMemo(() => partnersWithEvents(theme, events), [theme, events]);
  const [activeKey, setActiveKey] = useState<string | null>(initialPartner);
  const [link, setLink] = useState<SocialLink | null>(null);
  // Bumped per tap so repeat taps on the same card/pin re-fire.
  const nonce = useRef(0);

  // Host mode · demo (VITE_SOCIAL_HOST_DEMO): compose → pick a pin → post.
  const [hostOpen, setHostOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draftPin, setDraftPin] = useState<[number, number] | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Once a posted event shows up in the list, glow it (card + pin, fly-to).
  useEffect(() => {
    if (!pendingId || !events.some(e => e.id === pendingId)) return;
    setActiveKey(null);
    setLink({ id: pendingId, nonce: ++nonce.current, source: 'post' });
    setPendingId(null);
  }, [pendingId, events]);

  const activePartner = partners.find(p => p.key === activeKey) ?? null;
  const listEvents = useMemo(
    () => (activePartner ? events.filter(e => partnerMatches(activePartner, e)) : events),
    [events, activePartner],
  );

  const handleCardTap = useCallback((ev: SocialEvent) => {
    setLink({ id: ev.id, nonce: ++nonce.current, source: 'card' });
  }, []);

  const handlePinTap = useCallback((id: string) => {
    // A dimmed pin's card is filtered out of the list — go back to All first.
    const ev = events.find(e => e.id === id);
    if (activePartner && ev && !partnerMatches(activePartner, ev)) setActiveKey(null);
    setLink({ id, nonce: ++nonce.current, source: 'pin' });
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
        link={link}
        visible={visible}
        onPinTap={handlePinTap}
        pickMode={picking}
        draftPin={draftPin}
        onPick={p => { setDraftPin(p); setPicking(false); }}
      />
      {HOST_DEMO_ENABLED && !picking && (
        <button
          className="social-press"
          aria-label="Host mode: add an event"
          onClick={() => { hapticLight(); setHostOpen(true); }}
          style={{
            position: 'absolute', top: 28, right: 28, zIndex: 3, width: 36, height: 36, borderRadius: 18,
            display: 'grid', placeItems: 'center', cursor: 'pointer',
            background: 'var(--social-bg)', border: '1px solid var(--social-hairline)',
          }}
        >
          <Plus size={18} color="var(--text-primary)" />
        </button>
      )}
      {picking && (
        <div
          style={{
            position: 'absolute', top: 28, left: 28, right: 28, zIndex: 3,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            padding: '8px 12px', borderRadius: 10, background: 'var(--social-bg)', border: '1px solid var(--social-hairline)',
          }}
        >
          <span style={{ fontFamily: FONT, fontSize: 13, color: 'var(--text-primary)' }}>Tap the map to place the pin</span>
          <button
            className="social-press"
            onClick={() => { hapticLight(); setPicking(false); }}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
        </div>
      )}
      <PartnerTabs partners={partners} active={activeKey} onChange={setActiveKey} onOpenPage={onOpenPartnerPage} />
      {activePartner && <PartnerAboutCard partner={activePartner} />}
      <SocialEventList
        events={listEvents}
        theme={theme}
        link={link}
        emptyText={emptyText}
        onCardTap={handleCardTap}
      />
      {HOST_DEMO_ENABLED && (
        <HostSheet
          theme={theme}
          city={city}
          open={hostOpen}
          picking={picking}
          draftPin={draftPin}
          onPickLocation={() => setPicking(true)}
          onClose={() => { setHostOpen(false); setPicking(false); }}
          onPosted={id => { setHostOpen(false); setDraftPin(null); setPendingId(id); }}
        />
      )}
    </>
  );
}
