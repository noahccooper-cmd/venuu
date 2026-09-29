import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { CityKey } from '../lib/constants';
import {
  SOCIAL_THEME, SOCIAL_CITY_LABEL, socialThemeVars, partnersWithEvents, partnerMatches,
} from '../lib/socialTheme';
import type { SocialEvent } from '../lib/socialTypes';
import { countThisWeek } from '../lib/socialSections';
import { SOCIAL_CITIES, SOCIAL_CITY_GEO, TAMPA_BAY_BOUNDS, distanceKm, nearestCity } from '../lib/socialGeo';
import { getSocialLocation } from '../lib/socialLocation';
import { useSocialEvents } from '../hooks/useSocialEvents';
import { hapticLight } from '../lib/haptics';
import { HOST_DEMO_ENABLED } from '../lib/socialDemoStore';
import { SocialMap, type CameraSnapshot, type SocialLink, type SocialMapHandle } from '../components/Social/SocialMap';
import { SocialSheet, snapHeight, PEEK_PX, type SheetSnap } from '../components/Social/SocialSheet';
import {
  SheetHeader, WorldBody, CityBody, EventDetail, SunWorldHeader, SunWorldBody,
} from '../components/Social/SheetViews';
import { RunClubPage } from '../components/Social/RunClubPage';
import { Medallion } from '../components/Social/Medallion';
import { HostSheet } from '../components/Social/HostSheet';
import '../components/Social/social.css';

const FONT = 'Satoshi, sans-serif';
const CITY_ENTER_ZOOM = 8;     // zoomed in past this → the nearest city's sheet
const CITY_EXIT_ZOOM = 6.5;    // zoomed out below this → back to the world sheet
const DAY = 86_400_000;

type View = { kind: 'world' } | { kind: 'city'; city: CityKey };

interface SocialPageProps {
  /** True while the Social tab is the visible tab. */
  active: boolean;
}

/** Top of the usable map area: the bottom edge of the app's fixed header
 *  (which includes the safe area). Read-only — the header isn't touched. */
function useTopInset(): number {
  const [inset, setInset] = useState(56);
  useLayoutEffect(() => {
    const header = document.querySelector('header.fixed');
    if (!header) return;
    const read = () => setInset(Math.round(header.getBoundingClientRect().bottom));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);
  return inset;
}

/**
 * Social tab — a full-screen map (globe → street) with a draggable sheet.
 * See docs/social-tab-spec.md. Theme applies ONLY as CSS variables on this
 * root. Every state has a one-tap way back:
 *   event detail → its list · city → world · partner page → where you were
 *   Sun Cruiser World → exactly the camera/sheet/view you left.
 */
export function SocialPage({ active }: SocialPageProps) {
  const theme = SOCIAL_THEME;
  const mapRef = useRef<SocialMapHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const topInset = useTopInset();
  const [rootH, setRootH] = useState(700);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    setRootH(el.clientHeight);
    const ro = new ResizeObserver(() => setRootH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Data ──
  const knoxville = useSocialEvents('knoxville');
  const tampa = useSocialEvents('tampa');
  const pinellas = useSocialEvents('st_petersburg');
  const eventsByCity = useMemo<Record<CityKey, SocialEvent[]>>(() => ({
    knoxville: knoxville.events, tampa: tampa.events, st_petersburg: pinellas.events,
  }), [knoxville.events, tampa.events, pinellas.events]);
  const allEvents = useMemo(() => SOCIAL_CITIES.flatMap(c => eventsByCity[c]), [eventsByCity]);
  const counts = useMemo<Record<CityKey, number>>(() => ({
    knoxville: countThisWeek(eventsByCity.knoxville),
    tampa: countThisWeek(eventsByCity.tampa),
    st_petersburg: countThisWeek(eventsByCity.st_petersburg),
  }), [eventsByCity]);
  const worldPartners = useMemo(() => partnersWithEvents(theme, allEvents), [theme, allEvents]);
  const pinnedPartners = useMemo(() => worldPartners.filter(p => p.home), [worldPartners]);
  const presenter = theme.presentedBy ? theme.partners.find(p => p.key === theme.presentedBy!.partnerKey) ?? null : null;

  // ── Navigation state ──
  const [view, setView] = useState<View>({ kind: 'world' });
  const [snap, setSnap] = useState<SheetSnap>('peek');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [partnerPage, setPartnerPage] = useState<string | null>(null);
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const [worldFilter, setWorldFilter] = useState<string | null>(null);
  const [link, setLink] = useState<SocialLink | null>(null);
  const nonce = useRef(0);

  // Sun Cruiser World.
  const [sunWorld, setSunWorld] = useState(false);
  const [sunCity, setSunCity] = useState<CityKey | null>(null);
  const [sunOrigin, setSunOrigin] = useState<[number, number] | null>(null);
  const sunReturn = useRef<{ camera: CameraSnapshot | null; snap: SheetSnap; view: View; detailId: string | null } | null>(null);

  // Replay the globe arrival each time the Social tab opens.
  const [arrivalKey, setArrivalKey] = useState(0);
  useEffect(() => { if (active) setArrivalKey(k => k + 1); }, [active]);

  const sheetPx = snapHeight(snap, rootH);
  const halfPx = snapHeight('half', rootH);
  const fullPx = snapHeight('full', rootH);
  const detail = detailId ? allEvents.find(e => e.id === detailId) ?? null : null;
  const pagePartner = partnerPage ? theme.partners.find(p => p.key === partnerPage) ?? null : null;
  const city = view.kind === 'city' ? view.city : null;

  const cityPartners = useMemo(() => (city ? partnersWithEvents(theme, eventsByCity[city]) : []), [theme, city, eventsByCity]);
  const cityEvents = useMemo(() => {
    if (!city) return [];
    const p = cityPartners.find(x => x.key === cityFilter);
    return p ? eventsByCity[city].filter(e => partnerMatches(p, e)) : eventsByCity[city];
  }, [city, cityPartners, cityFilter, eventsByCity]);
  const thisWeek = useMemo(() => {
    const horizon = Date.now() + 7 * DAY;
    const p = worldPartners.find(x => x.key === worldFilter);
    const pick = (evs: SocialEvent[]) => evs.filter(e => new Date(e.start_time).getTime() < horizon && (!p || partnerMatches(p, e)));
    return { knoxville: pick(eventsByCity.knoxville), tampa: pick(eventsByCity.tampa), st_petersburg: pick(eventsByCity.st_petersburg) };
  }, [eventsByCity, worldPartners, worldFilter]);
  const sunEvents = useMemo(
    () => (presenter ? allEvents.filter(e => partnerMatches(presenter, e)) : []),
    [presenter, allEvents],
  );

  // ── Transitions ──
  const goWorld = useCallback(() => {
    setView({ kind: 'world' });
    setDetailId(null);
    setCityFilter(null);
    setSnap('peek');
    mapRef.current?.flyToWorld();
  }, []);

  const enterCity = useCallback((c: CityKey) => {
    setView({ kind: 'city', city: c });
    setDetailId(null);
    setCityFilter(null);
    setSnap('half');
    mapRef.current?.flyToCity(c, eventsByCity[c], halfPx);
  }, [eventsByCity, halfPx]);

  const openDetail = useCallback((ev: SocialEvent) => {
    const nextSnap: SheetSnap = snap === 'full' ? 'full' : 'half';
    setDetailId(ev.id);
    setSnap(nextSnap);
    mapRef.current?.flyToEvent(ev, snapHeight(nextSnap, rootH));
    setLink({ id: ev.id, nonce: ++nonce.current, source: 'card' });
  }, [snap, rootH]);

  const openPartnerPage = useCallback((key: string) => {
    const p = theme.partners.find(x => x.key === key);
    if (!p) return;
    setPartnerPage(key);
    setDetailId(null);
    setSnap('full');
    // A partner with a home (the run club) → fly to its city.
    if (p.home) {
      mapRef.current?.fitPoints(
        allEvents.filter(e => partnerMatches(p, e)).map(e => [e.longitude, e.latitude] as [number, number]).concat([p.home]),
        13, fullPx,
      );
      setView({ kind: 'city', city: nearestCity(p.home) });
    }
  }, [theme, allEvents, fullPx]);

  const flySunCity = useCallback((c: CityKey) => {
    setSunCity(c);
    // The list sorts by distance from the chosen city, so its events lead.
    setSunOrigin(SOCIAL_CITY_GEO[c].center);
    const pts = sunEvents.filter(e => e.city === c).map(e => [e.longitude, e.latitude] as [number, number]);
    if (pts.length) mapRef.current?.fitPoints(pts, 13, halfPx);
    else mapRef.current?.flyToCity(c, [], halfPx);
  }, [sunEvents, halfPx]);

  const enterSunWorld = useCallback(async () => {
    if (!presenter || sunWorld) return;
    sunReturn.current = { camera: mapRef.current?.getCamera() ?? null, snap, view, detailId };
    setSunWorld(true);
    setDetailId(null);
    setPartnerPage(null);
    setSnap('half');
    const loc = await getSocialLocation();
    const now = Date.now();
    const upcoming = sunEvents.filter(e => new Date(e.start_time).getTime() > now);
    let origin: [number, number];
    if (loc && upcoming.length) {
      const nearest = [...upcoming].sort((a, b) =>
        distanceKm(loc, [a.longitude, a.latitude]) - distanceKm(loc, [b.longitude, b.latitude]))[0];
      flySunCity(nearest.city);
      origin = loc;
    } else {
      // Fallback: Tampa Bay, framing both Tampa and St. Pete.
      setSunCity(null);
      mapRef.current?.fitPoints(TAMPA_BAY_BOUNDS, 11, halfPx);
      origin = [(TAMPA_BAY_BOUNDS[0][0] + TAMPA_BAY_BOUNDS[1][0]) / 2, (TAMPA_BAY_BOUNDS[0][1] + TAMPA_BAY_BOUNDS[1][1]) / 2];
    }
    setSunOrigin(origin);
    mapRef.current?.ignite(origin);
  }, [presenter, sunWorld, snap, view, detailId, sunEvents, flySunCity, halfPx]);

  const leaveSunWorld = useCallback(() => {
    const r = sunReturn.current;
    setSunWorld(false);
    setSunCity(null);
    setSunOrigin(null);
    setDetailId(r?.detailId ?? null);
    setSnap(r?.snap ?? 'peek');
    setView(r?.view ?? { kind: 'world' });
    if (r?.camera) mapRef.current?.setCamera(r.camera);
    sunReturn.current = null;
  }, []);

  // Manual zoom decides world vs city (never during Sun Cruiser World).
  const onViewChange = useCallback(({ zoom, center }: { zoom: number; center: [number, number] }) => {
    if (sunWorld || partnerPage) return;
    if (zoom >= CITY_ENTER_ZOOM) {
      const c = nearestCity(center);
      setView(v => (v.kind === 'city' && v.city === c ? v : { kind: 'city', city: c }));
      if (city !== c) setCityFilter(null);
    } else if (zoom < CITY_EXIT_ZOOM) {
      setView(v => (v.kind === 'world' ? v : { kind: 'world' }));
      setDetailId(null);
    }
  }, [sunWorld, partnerPage, city]);

  const onPinTap = useCallback((id: string) => {
    const ev = allEvents.find(e => e.id === id);
    if (ev) openDetail(ev);
  }, [allEvents, openDetail]);

  // ── Host mode · demo ──
  const [hostOpen, setHostOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draftPin, setDraftPin] = useState<[number, number] | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingId) return;
    const ev = allEvents.find(e => e.id === pendingId);
    if (!ev) return;
    setPendingId(null);
    if (sunWorld && sunOrigin) mapRef.current?.ignite(sunOrigin);   // relight incl. the new pin
    else if (!sunWorld) setView({ kind: 'city', city: ev.city });
    openDetail(ev);
    setLink({ id: ev.id, nonce: ++nonce.current, source: 'post' });
  }, [pendingId, allEvents, sunWorld, sunOrigin, openDetail]);

  // ── Sheet content for the current state ──
  let header: React.ReactNode;
  let body: React.ReactNode;
  let contentKey: string;

  if (detail) {
    header = <SheetHeader title={detail.title} onBack={() => setDetailId(null)} backLabel="Back to list" />;
    body = <EventDetail theme={theme} event={detail} />;
    contentKey = `detail-${detail.id}`;
  } else if (pagePartner) {
    header = (
      <SheetHeader
        onBack={() => { setPartnerPage(null); setSnap('half'); }}
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Medallion partner={pagePartner} size={32} />{pagePartner.label}</span>}
        color={pagePartner.color}
      />
    );
    body = <RunClubPage partner={pagePartner} runs={allEvents.filter(e => partnerMatches(pagePartner, e))} />;
    contentKey = `partner-${pagePartner.key}`;
  } else if (sunWorld && presenter && theme.sun) {
    header = <SunWorldHeader partner={presenter} sun={theme.sun} onLeave={leaveSunWorld} />;
    body = (
      <SunWorldBody
        theme={theme}
        partner={presenter}
        events={sunEvents}
        city={sunCity}
        origin={sunOrigin}
        onCity={flySunCity}
        onCardTap={openDetail}
      />
    );
    contentKey = 'sunworld';
  } else if (city) {
    header = (
      <SheetHeader
        title={SOCIAL_CITY_LABEL[city]}
        color={`var(--social-accent-${city})`}
        onBack={goWorld}
        backLabel="Back to all cities"
        right={<span className="social-num" style={{ fontFamily: FONT, fontSize: 13, color: 'var(--text-secondary)' }}>{eventsByCity[city].length} upcoming</span>}
      />
    );
    body = (
      <CityBody
        theme={theme}
        city={city}
        partners={cityPartners}
        events={cityEvents}
        active={cityFilter}
        link={link}
        onFilter={setCityFilter}
        onOpenPartnerPage={openPartnerPage}
        onCardTap={openDetail}
      />
    );
    contentKey = `city-${city}`;
  } else {
    const weekTotal = SOCIAL_CITIES.reduce((n, c) => n + counts[c], 0);
    header = (
      <SheetHeader
        title="Social"
        right={<span className="social-num" style={{ fontFamily: FONT, fontSize: 13, color: 'var(--text-secondary)' }}>{weekTotal} this week</span>}
      />
    );
    body = (
      <WorldBody
        theme={theme}
        partners={worldPartners}
        thisWeek={thisWeek}
        filter={worldFilter}
        onFilter={setWorldFilter}
        onOpenPartnerPage={openPartnerPage}
        onEnterSunWorld={enterSunWorld}
        onCardTap={ev => { setView({ kind: 'city', city: ev.city }); openDetail(ev); }}
      />
    );
    contentKey = 'world';
  }

  return (
    <div
      ref={rootRef}
      data-social-theme={theme.id}
      style={{
        ...socialThemeVars(theme, city),
        position: 'absolute',
        inset: 0,
        bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))',
        background: 'var(--social-bg)',
        overflow: 'hidden',
      } as React.CSSProperties}
    >
      <SocialMap
        ref={mapRef}
        theme={theme}
        events={allEvents}
        counts={counts}
        pinnedPartners={pinnedPartners}
        partners={city ? cityPartners : worldPartners}
        activePartner={city ? cityFilter : null}
        link={link}
        sunWorld={sunWorld}
        visible={active}
        arrivalKey={arrivalKey}
        topInset={topInset}
        sheetPx={sheetPx}
        peekPx={PEEK_PX}
        pickMode={picking}
        draftPin={draftPin}
        onPick={p => { setDraftPin(p); setPicking(false); }}
        onViewChange={onViewChange}
        onCityTap={enterCity}
        onPartnerTap={openPartnerPage}
        onSunTap={() => (sunWorld ? leaveSunWorld() : enterSunWorld())}
        onPinTap={onPinTap}
      />

      {HOST_DEMO_ENABLED && !picking && (
        <button
          className="social-press"
          aria-label="Host mode: add an event"
          onClick={() => { hapticLight(); setHostOpen(true); }}
          style={{
            position: 'absolute', left: 16, top: topInset + 16, zIndex: 4, width: 44, height: 44, borderRadius: 22,
            display: 'grid', placeItems: 'center', cursor: 'pointer',
            background: 'var(--social-bg)', border: '1px solid var(--social-hairline)',
          }}
        >
          <Plus size={20} color="var(--text-primary)" />
        </button>
      )}
      {picking && (
        <div
          style={{
            position: 'absolute', top: topInset + 16, left: 16, right: 16, zIndex: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            padding: '0 12px', minHeight: 44, borderRadius: 12, background: 'var(--social-bg)', border: '1px solid var(--social-hairline)',
          }}
        >
          <span style={{ fontFamily: FONT, fontSize: 13, color: 'var(--text-primary)' }}>Tap the map to place the pin</span>
          <button
            className="social-press"
            onClick={() => { hapticLight(); setPicking(false); }}
            style={{ minHeight: 44, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
        </div>
      )}

      {!picking && (
        <SocialSheet snap={snap} onSnap={setSnap} containerH={rootH} header={header} contentKey={contentKey}>
          {body}
        </SocialSheet>
      )}

      {HOST_DEMO_ENABLED && (
        <HostSheet
          theme={theme}
          city={draftPin ? nearestCity(draftPin) : city ?? 'tampa'}
          open={hostOpen}
          picking={picking}
          draftPin={draftPin}
          onPickLocation={() => setPicking(true)}
          onClose={() => { setHostOpen(false); setPicking(false); }}
          onPosted={id => { setHostOpen(false); setDraftPin(null); setPendingId(id); }}
        />
      )}
    </div>
  );
}
