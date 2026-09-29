import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { CityKey } from '../lib/constants';
import {
  SOCIAL_THEME, SOCIAL_CITY_LABEL, socialThemeVars, partnersWithEvents, partnerMatches,
} from '../lib/socialTheme';
import type { SocialEvent } from '../lib/socialTypes';
import { countThisWeek } from '../lib/socialSections';
import { SOCIAL_CITIES, SOCIAL_CITY_GEO, distanceKm, nearestCity } from '../lib/socialGeo';
import { getSocialLocation } from '../lib/socialLocation';
import { worldPalette } from '../lib/socialMapStyle';
import { SUN_BRAND_SLUG } from '../lib/brands';
import { useSocialEvents } from '../hooks/useSocialEvents';
import { useBrands } from '../hooks/useBrands';
import { hapticLight } from '../lib/haptics';
import { HOST_DEMO_ENABLED } from '../lib/socialDemoStore';
import { SocialMap, type CameraSnapshot, type SocialLink, type SocialMapHandle, type SocialWorld } from '../components/Social/SocialMap';
import { SocialSheet, snapHeight, PEEK_PX, type SheetSnap } from '../components/Social/SocialSheet';
import { SheetHeader, WorldBody, CityBody, EventDetail } from '../components/Social/SheetViews';
import { PartnerWorld, AgeGate } from '../components/Social/PartnerWorld';
import { ageConfirmed, worldOrder, WORLD_TOP_PX, WORLD_BOTTOM_PX } from '../lib/partnerWorld';
import { HostSheet } from '../components/Social/HostSheet';
import '../components/Social/social.css';

const FONT = 'Satoshi, sans-serif';
const CITY_ENTER_ZOOM = 8;     // zoomed in past this → the nearest city's sheet
const CITY_EXIT_ZOOM = 6.5;    // zoomed out below this → back to the world sheet
const DAY = 86_400_000;
const LOCATION_WAIT_MS = 2500;   // Partner World entry never waits longer on GPS

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
 *   event detail → its list · city → world
 *   a Partner World → exactly the camera/sheet/view you left.
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
  const brands = useBrands();

  // ── Navigation state ──
  const [view, setView] = useState<View>({ kind: 'world' });
  const [snap, setSnap] = useState<SheetSnap>('peek');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [cityFilter, setCityFilter] = useState<string | null>(null);
  const [worldFilter, setWorldFilter] = useState<string | null>(null);
  const [link, setLink] = useState<SocialLink | null>(null);
  const nonce = useRef(0);

  // Partner World (one template for every brand row).
  const [worldSlug, setWorldSlug] = useState<string | null>(null);
  const [worldCity, setWorldCity] = useState<CityKey | null>(null);
  const [worldSel, setWorldSel] = useState<string | null>(null);
  const [worldFly, setWorldFly] = useState<{ slug: string; city: CityKey; pick: string | null; n: number } | null>(null);
  const [gateSlug, setGateSlug] = useState<string | null>(null);
  const worldReturn = useRef<{ camera: CameraSnapshot | null; snap: SheetSnap; view: View; detailId: string | null } | null>(null);

  // Replay the globe arrival each time the Social tab opens.
  const [arrivalKey, setArrivalKey] = useState(0);
  useEffect(() => { if (active) setArrivalKey(k => k + 1); }, [active]);

  const sheetPx = snapHeight(snap, rootH);
  const halfPx = snapHeight('half', rootH);
  const detail = detailId ? allEvents.find(e => e.id === detailId) ?? null : null;
  const city = view.kind === 'city' ? view.city : null;
  const worldBrand = worldSlug ? brands.find(b => b.slug === worldSlug) ?? null : null;
  const gateBrand = gateSlug ? brands.find(b => b.slug === gateSlug) ?? null : null;
  const worldEvents = useMemo(
    () => (worldBrand && worldCity ? allEvents.filter(e => e.brand === worldBrand.slug && e.city === worldCity).sort(worldOrder) : []),
    [worldBrand, worldCity, allEvents],
  );
  const mapWorld = useMemo<SocialWorld | null>(
    () => (worldBrand ? { brand: worldBrand.slug, palette: worldPalette(worldBrand.primary_hex) } : null),
    [worldBrand],
  );

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

  // ── Partner World ──
  /** Choose a city inside the World: the carousel resets to its first
   *  event (or `pick`); the camera move runs after render (see below). */
  const selectWorldCity = useCallback((slug: string, c: CityKey, pick: string | null = null) => {
    const evs = allEvents.filter(e => e.brand === slug && e.city === c).sort(worldOrder);
    setWorldCity(c);
    setWorldSel((pick && evs.some(e => e.id === pick) ? pick : evs[0]?.id) ?? null);
    setWorldFly({ slug, city: c, pick, n: ++nonce.current });
  }, [allEvents]);

  // Camera for World city changes — after render, so the map already has
  // the World's top/bottom clearance.
  useEffect(() => {
    if (!worldFly) return;
    const evs = allEvents.filter(e => e.brand === worldFly.slug && e.city === worldFly.city);
    const picked = worldFly.pick ? evs.find(e => e.id === worldFly.pick) : null;
    if (picked) mapRef.current?.panToEvent(picked, WORLD_BOTTOM_PX);
    else if (evs.length) mapRef.current?.fitPoints(evs.map(e => [e.longitude, e.latitude] as [number, number]), 13, WORLD_BOTTOM_PX);
    else mapRef.current?.flyToCity(worldFly.city, [], WORLD_BOTTOM_PX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldFly]);

  const enterWorld = useCallback(async (slug: string, gatePassed = false) => {
    const b = brands.find(x => x.slug === slug);
    if (!b) return;
    if (b.age_gate && !gatePassed && !ageConfirmed(slug)) { setGateSlug(slug); return; }
    if (!worldSlug) worldReturn.current = { camera: mapRef.current?.getCamera() ?? null, snap, view, detailId };
    setWorldSlug(slug);
    setWorldCity(null);
    setDetailId(null);
    // Skip the globe: straight to the nearest city with this partner's
    // events (location asked once); else the row's first city.
    const cities = b.cities.length ? b.cities : SOCIAL_CITIES;
    const withEvents = cities.filter(c => allEvents.some(e => e.brand === slug && e.city === c));
    let target: CityKey = cities[0];
    if (withEvents.length) {
      const loc = await Promise.race([
        getSocialLocation(),
        new Promise<null>(r => window.setTimeout(() => r(null), LOCATION_WAIT_MS)),
      ]);
      if (loc) target = [...withEvents].sort((x, y) => distanceKm(loc, SOCIAL_CITY_GEO[x].center) - distanceKm(loc, SOCIAL_CITY_GEO[y].center))[0];
    }
    selectWorldCity(slug, target);
  }, [brands, worldSlug, snap, view, detailId, allEvents, selectWorldCity]);

  const leaveWorld = useCallback(() => {
    const r = worldReturn.current;
    setWorldSlug(null);
    setWorldCity(null);
    setWorldSel(null);
    setWorldFly(null);
    setDetailId(r?.detailId ?? null);
    setSnap(r?.snap ?? 'peek');
    setView(r?.view ?? { kind: 'world' });
    if (r?.camera) mapRef.current?.setCamera(r.camera);
    worldReturn.current = null;
  }, []);

  const onWorldSwipe = useCallback((ev: SocialEvent) => {
    setWorldSel(ev.id);
    mapRef.current?.panToEvent(ev, WORLD_BOTTOM_PX);
    setLink({ id: ev.id, nonce: ++nonce.current, source: 'card' });
  }, []);

  /** Partner medallions / cards / tabs open that partner's World. */
  const openPartnerPage = useCallback((key: string) => {
    if (brands.some(b => b.slug === key)) void enterWorld(key);
  }, [brands, enterWorld]);

  // Manual zoom decides world vs city (never during Sun Cruiser World).
  const onViewChange = useCallback(({ zoom, center }: { zoom: number; center: [number, number] }) => {
    if (worldSlug) return;
    if (zoom >= CITY_ENTER_ZOOM) {
      const c = nearestCity(center);
      setView(v => (v.kind === 'city' && v.city === c ? v : { kind: 'city', city: c }));
      if (city !== c) setCityFilter(null);
    } else if (zoom < CITY_EXIT_ZOOM) {
      setView(v => (v.kind === 'world' ? v : { kind: 'world' }));
      setDetailId(null);
    }
  }, [worldSlug, city]);

  const onPinTap = useCallback((id: string) => {
    const ev = allEvents.find(e => e.id === id);
    if (!ev) return;
    if (worldSlug) {
      // Pin → its card (switching city if the pin is in another one).
      if (ev.brand !== worldSlug) return;
      if (ev.city !== worldCity) { selectWorldCity(worldSlug, ev.city, ev.id); return; }
      setWorldSel(ev.id);
      mapRef.current?.panToEvent(ev, WORLD_BOTTOM_PX);
      return;
    }
    openDetail(ev);
  }, [allEvents, openDetail, worldSlug, worldCity, selectWorldCity]);

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
    setView({ kind: 'city', city: ev.city });
    openDetail(ev);
    setLink({ id: ev.id, nonce: ++nonce.current, source: 'post' });
  }, [pendingId, allEvents, openDetail]);

  // ── Sheet content for the current state ──
  let header: React.ReactNode;
  let body: React.ReactNode;
  let contentKey: string;

  if (detail) {
    header = <SheetHeader title={detail.title} onBack={() => setDetailId(null)} backLabel="Back to list" />;
    body = <EventDetail theme={theme} event={detail} />;
    contentKey = `detail-${detail.id}`;
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
        brands={brands}
        onOpenPartnerPage={openPartnerPage}
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
        // clip (not hidden): the root can never be scrolled programmatically
        // (e.g. by focusing an off-screen sheet), which would shift the map.
        overflow: 'clip',
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
        world={mapWorld}
        selectedId={worldSel}
        topExtra={worldSlug ? WORLD_TOP_PX : 0}
        visible={active}
        arrivalKey={arrivalKey}
        topInset={topInset}
        sheetPx={worldSlug ? WORLD_BOTTOM_PX : sheetPx}
        peekPx={PEEK_PX}
        pickMode={picking}
        draftPin={draftPin}
        onPick={p => { setDraftPin(p); setPicking(false); }}
        onViewChange={onViewChange}
        onCityTap={enterCity}
        onPartnerTap={openPartnerPage}
        onSunTap={() => void enterWorld(SUN_BRAND_SLUG)}
        onPinTap={onPinTap}
      />

      {HOST_DEMO_ENABLED && !picking && !worldSlug && (
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

      {worldBrand && worldCity && (
        <PartnerWorld
          brand={worldBrand}
          city={worldCity}
          events={worldEvents}
          selectedId={worldSel}
          topInset={topInset}
          onCity={c => selectWorldCity(worldBrand.slug, c)}
          onSelect={onWorldSwipe}
          onClose={leaveWorld}
        />
      )}

      {gateBrand && (
        <AgeGate
          brand={gateBrand}
          onYes={() => { setGateSlug(null); void enterWorld(gateBrand.slug, true); }}
          onNo={() => { setGateSlug(null); if (!worldSlug) goWorld(); }}
        />
      )}

      {!picking && !worldSlug && (
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
