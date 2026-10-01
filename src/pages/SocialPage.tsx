import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CityKey } from '../lib/constants';
import { SOCIAL_THEME, SOCIAL_CITY_LABEL, socialThemeVars, partnersWithEvents } from '../lib/socialTheme';
import type { SocialEvent } from '../lib/socialTypes';
import { countThisWeek } from '../lib/socialSections';
import { SOCIAL_CITIES, SOCIAL_CITY_GEO, distanceKm, nearestCity } from '../lib/socialGeo';
import { getSocialLocation } from '../lib/socialLocation';
import { worldPalette } from '../lib/socialMapStyle';
import { SUN_BRAND_SLUG, brandColor } from '../lib/brands';
import {
  buildPlaces, placeStatus, orderPlaces, hasNew, markSeen, isLive, CITY_CODE, type PlaceKey,
} from '../lib/socialPlaces';
import { hapticLight, hapticMedium, hapticSuccess, hapticWarning } from '../lib/haptics';
import { SOCIAL_DEMO, takeLastVisit } from '../lib/socialMode';
import { eventColor } from '../lib/socialTheme';
import { useSocialEvents } from '../hooks/useSocialEvents';
import { useBrands } from '../hooks/useBrands';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { useGoing } from '../hooks/useGoing';
import {
  SocialMap, type CameraSnapshot, type PlaceFilter, type PullSun, type SocialLink, type SocialMapHandle, type SocialWorld,
} from '../components/Social/SocialMap';
import { PlaceWorld, AgeGate, LogoDisc, CityBadge, type PlaceTab } from '../components/Social/PlaceWorld';
import { StoryRings, PlaceCarousel, HomeSkeleton, RINGS_H } from '../components/Social/SocialHome';
import { ageConfirmed, worldOrder, WORLD_TOP_PX, WORLD_BOTTOM_PX } from '../lib/partnerWorld';
import { PostFlow } from '../components/Social/PostFlow';
import { useSocialProfile } from '../hooks/useSocialProfile';
import { acceptTerms, submitPost, type PostDraft } from '../lib/socialPost';
import { SocialFeed } from '../components/Social/SocialFeed';
import { SocialToast, type ToastMsg } from '../components/Social/SocialToast';
import '../components/Social/social.css';

const FONT = 'Satoshi, sans-serif';
const LOCATION_WAIT_MS = 2500;   // a World never waits longer on GPS
const IDLE_RESHUFFLE_MS = 5000;  // reorder places only after this much stillness
const CLOCK_MS = 60_000;
const VENUU_ORANGE = '#FF8200';  // --brand-orange; hex needed for glows

const CITY_TABS: PlaceTab[] = [
  { key: 'all', label: 'All' },
  { key: 'run_club', label: 'Run Clubs' },
  { key: 'pop_up', label: 'Pop-Ups' },
  { key: 'nightlife', label: 'Nightlife' },
  { key: 'community', label: 'Community' },
];

type Open =
  | { kind: 'brand'; slug: string; city: CityKey | null }
  | { kind: 'city'; city: CityKey; filter: PlaceFilter | 'all' };

function matchesFilter(e: SocialEvent, f: PlaceFilter | 'all'): boolean {
  if (f === 'all') return true;
  if (f === 'community') return e.verification === 'community';
  return e.category === f;
}

interface SocialPageProps {
  /** True while the Social tab is the visible tab. */
  active: boolean;
  /** Signed-in profile (null signed out). */
  profileId: string | null;
  /** Opens the app's sign-in sheet (Going while signed out). */
  onOpenSignIn: () => void;
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
 * Social tab. Home = the globe with story rings on top and a place
 * carousel at the bottom (cities + partner Worlds); swiping turns the
 * globe to the place. Tapping a place opens it in one template (a partner
 * World, or a city with category filters). See docs/social-tab-spec.md.
 * Theme applies ONLY as CSS variables on this root.
 */
export function SocialPage({ active, profileId, onOpenSignIn }: SocialPageProps) {
  const theme = SOCIAL_THEME;
  const mapRef = useRef<SocialMapHandle>(null);
  const topInset = useTopInset();

  // ── Data ──
  const [refreshKey, setRefreshKey] = useState(0);
  const knoxville = useSocialEvents('knoxville', refreshKey);
  const tampa = useSocialEvents('tampa', refreshKey);
  const pinellas = useSocialEvents('st_petersburg', refreshKey);
  const eventsByCity = useMemo<Record<CityKey, SocialEvent[]>>(() => ({
    knoxville: knoxville.events, tampa: tampa.events, st_petersburg: pinellas.events,
  }), [knoxville.events, tampa.events, pinellas.events]);
  const allEvents = useMemo(() => SOCIAL_CITIES.flatMap(c => eventsByCity[c]), [eventsByCity]);
  /** First load finished — order and selection wait for it. */
  const ready = !knoxville.loading && !tampa.loading && !pinellas.loading;
  const counts = useMemo<Record<CityKey, number>>(() => ({
    knoxville: countThisWeek(eventsByCity.knoxville),
    tampa: countThisWeek(eventsByCity.tampa),
    st_petersburg: countThisWeek(eventsByCity.st_petersburg),
  }), [eventsByCity]);
  const worldPartners = useMemo(() => partnersWithEvents(theme, allEvents), [theme, allEvents]);
  const pinnedPartners = useMemo(() => worldPartners.filter(p => p.home), [worldPartners]);
  const brands = useBrands(refreshKey);
  const brandOf = useCallback((ev: SocialEvent) => brands.find(b => b.slug === ev.brand) ?? null, [brands]);
  const sunBrand = brands.find(b => b.slug === SUN_BRAND_SLUG) ?? null;

  // ── Clock (countdowns, ordering) ──
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(t);
  }, []);

  // ── Places ──
  const places = useMemo(() => buildPlaces(allEvents, brands, now), [allEvents, brands, now]);
  const status = useMemo(() => Object.fromEntries(places.map(p => [p.key, placeStatus(p, now)])), [places, now]);
  const desired = useMemo(() => orderPlaces(places, now), [places, now]);
  const [order, setOrder] = useState<PlaceKey[]>([]);
  const [sel, setSel] = useState<PlaceKey | null>(null);
  // Reorders animate (FLIP) only for idle reshuffles and returns to home;
  // a fresh arrival just shows the right order.
  const animateReorder = useRef(false);
  const orderedPlaces = useMemo(() => {
    const byKey = new Map(places.map(p => [p.key, p]));
    const base = order.length ? order : desired;
    const keys = [...base.filter(k => byKey.has(k)), ...places.map(p => p.key).filter(k => !base.includes(k))];
    return keys.map(k => byKey.get(k)!);
  }, [places, order, desired]);

  // ── Open place ──
  const [open, setOpen] = useState<Open | null>(null);
  const [placeSel, setPlaceSel] = useState<string | null>(null);
  const [fly, setFly] = useState(0);
  const [gateSlug, setGateSlug] = useState<string | null>(null);
  const [link, setLink] = useState<SocialLink | null>(null);
  const [seenTick, setSeenTick] = useState(0);
  const openReturn = useRef<CameraSnapshot | null>(null);
  const nonce = useRef(0);

  const openBrand = open?.kind === 'brand' ? brands.find(b => b.slug === open.slug) ?? null : null;
  const placeEvents = useMemo(() => {
    if (!open) return [];
    if (open.kind === 'brand') return open.city ? allEvents.filter(e => e.brand === open.slug && e.city === open.city).sort(worldOrder) : [];
    return allEvents.filter(e => e.city === open.city && matchesFilter(e, open.filter)).sort(worldOrder);
  }, [open, allEvents]);
  const placeEventsRef = useRef(placeEvents);
  placeEventsRef.current = placeEvents;

  // ── Touch / idle tracking: never reorder under a finger ──
  const touching = useRef(false);
  const lastInput = useRef(0);
  const onPointerDownCapture = () => { touching.current = true; lastInput.current = performance.now(); };
  const onPointerUpCapture = () => { touching.current = false; lastInput.current = performance.now(); };

  const desiredKey = desired.join('|');
  useEffect(() => {
    if (!ready || order.join('|') === desiredKey) return;
    if (order.length === 0) { setOrder(desired); return; }
    const t = window.setInterval(() => {
      if (!touching.current && !open && performance.now() - lastInput.current >= IDLE_RESHUFFLE_MS) {
        animateReorder.current = true;
        setOrder(desired);
      }
    }, 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desiredKey, order, open, ready]);

  useEffect(() => {
    if (ready && !sel && orderedPlaces.length) setSel(orderedPlaces[0].key);
  }, [ready, sel, orderedPlaces]);

  // ── Home: the globe follows the carousel ──
  const selectPlace = useCallback((key: PlaceKey) => {
    setSel(key);
    const p = places.find(x => x.key === key);
    if (p) mapRef.current?.flyToPlace(p.center);
  }, [places]);

  // Replay the arrival each time the Social tab opens, then turn to the
  // selected place; reshuffle on return.
  const [arrivalKey, setArrivalKey] = useState(0);
  useEffect(() => { if (active) setArrivalKey(k => k + 1); }, [active]);
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    if (!active || open || !ready) return;
    // A fresh arrival starts on the first card of the fresh order.
    animateReorder.current = false;
    setOrder(desired);
    setSel(desired[0] ?? null);
    const t = window.setTimeout(() => {
      setArrived(true);
      const p = places.find(x => x.key === desired[0]);
      if (p) mapRef.current?.flyToPlace(p.center);
    }, 900);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivalKey, ready]);

  // ── Place camera — after render, so the map already has the place's
  //    top/bottom clearance ──
  useEffect(() => {
    if (!fly || !open) return;
    const evs = placeEventsRef.current;
    const picked = placeSel ? evs.find(e => e.id === placeSel) : null;
    if (picked && fly < 0) mapRef.current?.panToEvent(picked, WORLD_BOTTOM_PX);
    else if (evs.length) mapRef.current?.fitPoints(evs.map(e => [e.longitude, e.latitude] as [number, number]), 13, WORLD_BOTTOM_PX);
    else if (open.kind === 'city' || open.city) mapRef.current?.flyToCity(open.kind === 'city' ? open.city : open.city!, [], WORLD_BOTTOM_PX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fly]);
  /** fitAll: frame every event in the tab; else glide to the picked one. */
  const flyNext = (fitAll: boolean) => setFly(fitAll ? Math.abs(fly) + 1 : -(Math.abs(fly) + 1));

  const selectFirst = (evs: SocialEvent[], pick: string | null) =>
    setPlaceSel((pick && evs.some(e => e.id === pick) ? pick : evs[0]?.id) ?? null);

  const enterWorld = useCallback(async (slug: string, gatePassed = false, pick: string | null = null) => {
    const b = brands.find(x => x.slug === slug);
    if (!b) return;
    if (b.age_gate && !gatePassed && !ageConfirmed(slug)) { setGateSlug(slug); return; }
    hapticMedium();
    if (!open) openReturn.current = mapRef.current?.getCamera() ?? null;
    markSeen(slug);
    setSeenTick(t => t + 1);
    setOpen({ kind: 'brand', slug, city: null });
    // Skip the globe: nearest city with this partner's events (location
    // asked once), else the row's first city.
    const cities = b.cities.length ? b.cities : SOCIAL_CITIES;
    const withEvents = cities.filter(c => allEvents.some(e => e.brand === slug && e.city === c));
    let target: CityKey = cities[0];
    const pickEv = pick ? allEvents.find(e => e.id === pick) : null;
    if (pickEv) target = pickEv.city;
    else if (withEvents.length) {
      const loc = await Promise.race([
        getSocialLocation(),
        new Promise<null>(r => window.setTimeout(() => r(null), LOCATION_WAIT_MS)),
      ]);
      if (loc) target = [...withEvents].sort((x, y) => distanceKm(loc, SOCIAL_CITY_GEO[x].center) - distanceKm(loc, SOCIAL_CITY_GEO[y].center))[0];
    }
    setOpen({ kind: 'brand', slug, city: target });
    selectFirst(allEvents.filter(e => e.brand === slug && e.city === target).sort(worldOrder), pick);
    flyNext(!pick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brands, open, allEvents, fly]);

  const enterCity = useCallback((city: CityKey, pick: string | null = null) => {
    hapticMedium();
    if (!open) openReturn.current = mapRef.current?.getCamera() ?? null;
    setOpen({ kind: 'city', city, filter: 'all' });
    selectFirst(allEvents.filter(e => e.city === city).sort(worldOrder), pick);
    flyNext(!pick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, allEvents, fly]);

  const enterPlace = useCallback((key: PlaceKey, pick: string | null = null) => {
    setSel(key);
    if (key.startsWith('city:')) enterCity(key.slice(5) as CityKey, pick);
    else void enterWorld(key.slice(6), false, pick);
  }, [enterCity, enterWorld]);

  const leavePlace = useCallback(() => {
    const cam = openReturn.current;
    setOpen(null);
    setPlaceSel(null);
    if (cam) mapRef.current?.setCamera(cam);
    openReturn.current = null;
    // Back on home: settle into the fresh order right away (animated).
    animateReorder.current = true;
    setOrder(desired);
  }, [desired]);

  const onTab = (key: string) => {
    if (!open) return;
    if (open.kind === 'brand') {
      const c = key as CityKey;
      setOpen({ ...open, city: c });
      selectFirst(allEvents.filter(e => e.brand === open.slug && e.city === c).sort(worldOrder), null);
    } else {
      const f = key as PlaceFilter | 'all';
      setOpen({ ...open, filter: f });
      selectFirst(allEvents.filter(e => e.city === open.city && matchesFilter(e, f)).sort(worldOrder), null);
    }
    flyNext(true);
  };

  const onPlaceSwipe = useCallback((ev: SocialEvent) => {
    setPlaceSel(ev.id);
    mapRef.current?.panToEvent(ev, WORLD_BOTTOM_PX);
    setLink({ id: ev.id, nonce: ++nonce.current, source: 'card' });
  }, []);

  const onPinTap = useCallback((id: string) => {
    const ev = allEvents.find(e => e.id === id);
    if (!ev) return;
    if (!open) { enterPlace(`city:${ev.city}`, ev.id); return; }
    if (open.kind === 'brand') {
      if (ev.brand !== open.slug) return;
      if (ev.city !== open.city) {
        setOpen({ ...open, city: ev.city });
        selectFirst(allEvents.filter(e => e.brand === open.slug && e.city === ev.city).sort(worldOrder), ev.id);
        flyNext(false);
        return;
      }
    }
    setPlaceSel(ev.id);
    mapRef.current?.panToEvent(ev, WORLD_BOTTOM_PX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEvents, open, enterPlace, fly]);

  const mapWorld = useMemo<SocialWorld | null>(() => {
    if (!open) return null;
    if (open.kind === 'brand') {
      return { key: `brand:${open.slug}`, brand: open.slug, city: null, filter: null, palette: worldPalette(openBrand?.primary_hex ?? null) };
    }
    return { key: `city:${open.city}`, brand: null, city: open.city, filter: open.filter === 'all' ? null : open.filter, palette: null };
  }, [open, openBrand]);

  // ── Feed + Going ──
  type FeedCtx = { title: string; events: SocialEvent[]; startId: string | null };
  const [feed, setFeed] = useState<FeedCtx | null>(null);
  const [newSince] = useState(() => takeLastVisit());
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const say = useCallback((text: string, tone: ToastMsg['tone'] = 'ok') => setToast({ id: Date.now(), text, tone }), []);
  const going = useGoing(profileId, useMemo(() => (feed ? feed.events : placeEvents).map(e => e.id), [feed, placeEvents]));
  // Demo builds act as a signed-in demo user (RSVPs stay in this browser).
  const signedIn = !!profileId || SOCIAL_DEMO;
  const pendingGoing = useRef<SocialEvent | null>(null);

  const onGoing = useCallback(async (ev: SocialEvent, on: boolean): Promise<boolean> => {
    if (!signedIn) {
      pendingGoing.current = on ? ev : null;
      say('Sign in to say you’re going');
      onOpenSignIn();
      return false;
    }
    if (on) hapticMedium(); else hapticLight();
    const ok = await going.toggle(ev, on);
    if (!ok) { hapticWarning(); say('Couldn’t save that — try again', 'warn'); }
    return ok;
  }, [signedIn, going, say, onOpenSignIn]);

  // Signed in from the prompt → finish the RSVP they started.
  useEffect(() => {
    const ev = pendingGoing.current;
    if (!profileId || !ev) return;
    pendingGoing.current = null;
    void going.toggle(ev, true).then(ok => {
      if (ok) { hapticMedium(); say(`You’re going · ${ev.title}`); } else { hapticWarning(); say('Couldn’t save that — try again', 'warn'); }
    });
  }, [profileId, going, say]);

  const feedOrder = (a: SocialEvent, b: SocialEvent) => {
    const la = isLive(a, now) ? 0 : 1;
    const lb = isLive(b, now) ? 0 : 1;
    return la - lb || worldOrder(a, b);
  };
  const openFeedHome = () => {
    const evs = allEvents.filter(e => e.date_tba || new Date(e.end_time ?? e.start_time).getTime() > now).sort(feedOrder);
    const p = places.find(x => x.key === sel);
    const startId = (p && status[p.key]?.next?.id) ?? evs[0]?.id ?? null;
    hapticMedium();
    setFeed({ title: 'All places', events: evs, startId });
  };
  const openFeedPlace = () => {
    if (!open) return;
    hapticMedium();
    if (open.kind === 'brand') {
      const evs = allEvents.filter(e => e.brand === open.slug).sort(feedOrder);
      setFeed({ title: `${openBrand?.name ?? ''} World`, events: evs, startId: placeSel });
    } else {
      const tabLabel = open.filter === 'all' ? '' : ` · ${CITY_TABS.find(t => t.key === open.filter)?.label}`;
      setFeed({ title: `${SOCIAL_CITY_LABEL[open.city]}${tabLabel}`, events: [...placeEvents].sort(feedOrder), startId: placeSel });
    }
  };
  const closeFeed = (currentId: string | null) => {
    setFeed(null);
    const ev = currentId ? allEvents.find(e => e.id === currentId) : null;
    if (!ev) return;
    if (!open) {
      // Home: land on the event's place (its partner World, else its city).
      const key = (ev.brand && places.some(p => p.key === `brand:${ev.brand}`) ? `brand:${ev.brand}` : `city:${ev.city}`) as PlaceKey;
      selectPlace(key);
      return;
    }
    if (open.kind === 'brand' && ev.city !== open.city) {
      setOpen({ ...open, city: ev.city });
      setPlaceSel(ev.id);
      flyNext(false);
      return;
    }
    setPlaceSel(ev.id);
    mapRef.current?.panToEvent(ev, WORLD_BOTTOM_PX);
  };

  // ── Story rings ──
  const fresh = useMemo(() => Object.fromEntries(brands.map(b => [b.slug, hasNew(allEvents.filter(e => e.brand === b.slug), b.slug)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [brands, allEvents, seenTick]);

  // ── Post ──
  const me = useSocialProfile(profileId);
  const canHost = me.role === 'host' || me.role === 'admin';
  const [postOpen, setPostOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draftPin, setDraftPin] = useState<[number, number] | null>(null);
  const [pending, setPending] = useState<{ id: string; verified: boolean } | null>(null);
  const [justPosted, setJustPosted] = useState<string | null>(null);
  const onPost = () => {
    hapticLight();
    if (!signedIn) { say('Sign in to post an event'); onOpenSignIn(); return; }
    if (me.banned) { hapticWarning(); say('Your account can’t post events right now.', 'warn'); return; }
    setPostOpen(true);
  };
  const submit = useCallback(async (d: PostDraft) => {
    const r = await submitPost(d, { profileId, brands, isAdmin: me.role === 'admin', hostName: me.name });
    if (r.ok) {
      setPostOpen(false);
      setDraftPin(null);
      setPending({ id: r.id, verified: r.verified });
      setRefreshKey(k => k + 1);      // live: refetch so the new row appears
    }
    return r;
  }, [profileId, brands, me.role, me.name]);
  // Success: once the new event is in the data — fly to its pin, ripple,
  // the card slides into the carousel with a glow, haptic, toast.
  useEffect(() => {
    if (!pending) return;
    const ev = allEvents.find(e => e.id === pending.id);
    if (!ev) return;
    setPending(null);
    setFeed(null);
    enterPlace(`city:${ev.city}`, ev.id);
    setJustPosted(ev.id);
    setLink({ id: ev.id, nonce: ++nonce.current, source: 'post' });
    hapticSuccess();
    say(`Your event is live · ${pending.verified ? 'Verified' : 'Community'}`);
    const t = window.setTimeout(() => setJustPosted(null), 2600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, allEvents]);

  // ── Pull to refresh ──
  const pull = usePullToRefresh(async () => {
    setRefreshKey(k => k + 1);
    await new Promise(r => window.setTimeout(r, 300));
  });
  const [sunCore, sunMid] = sunBrand?.accent_hexes ?? [];
  const pullSun: PullSun | null = !open && (pull.progress > 0 || pull.refreshing)
    ? { progress: pull.progress, refreshing: pull.refreshing, core: sunCore ?? '#FFB347', mid: sunMid ?? VENUU_ORANGE }
    : null;

  // ── Open place config for the template ──
  let placeView: React.ReactNode = null;
  if (open?.kind === 'brand' && openBrand && open.city) {
    placeView = (
      <PlaceWorld
        mark={<LogoDisc brand={openBrand} size={40} />}
        title={<>{openBrand.name} <span style={{ color: brandColor(openBrand) }}>World</span></>}
        name={`${openBrand.name} World`}
        accent={brandColor(openBrand)}
        about={openBrand}
        tabs={(openBrand.cities.length ? openBrand.cities : [open.city]).map(c => ({ key: c, label: SOCIAL_CITY_LABEL[c] ?? c }))}
        tab={open.city}
        tabsLabel="City"
        onTab={onTab}
        events={placeEvents}
        brandOf={brandOf}
        selectedId={placeSel}
        empty={{ title: `Coming soon to ${SOCIAL_CITY_LABEL[open.city]}`, line: `No ${openBrand.name} events here yet. Check back soon.` }}
        topInset={topInset}
        onSelect={onPlaceSwipe}
        onClose={leavePlace}
        onOpenFeed={openFeedPlace}
        highlightId={justPosted}
      />
    );
  } else if (open?.kind === 'city') {
    const label = SOCIAL_CITY_LABEL[open.city];
    const tabLabel = CITY_TABS.find(t => t.key === open.filter)?.label ?? '';
    const accent = `var(--social-accent-${open.city})`;
    placeView = (
      <PlaceWorld
        mark={<CityBadge code={CITY_CODE[open.city]} accent={accent} size={40} />}
        title={label}
        name={label}
        accent={accent}
        about={null}
        tabs={CITY_TABS}
        tab={open.filter}
        tabsLabel="Filter"
        onTab={onTab}
        events={placeEvents}
        brandOf={brandOf}
        selectedId={placeSel}
        empty={open.filter === 'all'
          ? { title: `Nothing scheduled in ${label} yet`, line: 'Be the first to post an event here.', action: { label: 'Post an event', onTap: onPost } }
          : { title: `No ${tabLabel} in ${label} yet`, line: 'Check back soon, or see everything.', action: { label: 'Show all', onTap: () => onTab('all') } }}
        topInset={topInset}
        onSelect={onPlaceSwipe}
        onClose={leavePlace}
        onOpenFeed={openFeedPlace}
        highlightId={justPosted}
      />
    );
  }
  const gateBrand = gateSlug ? brands.find(b => b.slug === gateSlug) ?? null : null;
  const home = !open && !picking;

  return (
    <div
      data-social-theme={theme.id}
      onPointerDownCapture={onPointerDownCapture}
      onPointerUpCapture={onPointerUpCapture}
      onPointerCancelCapture={onPointerUpCapture}
      style={{
        ...socialThemeVars(theme, open?.kind === 'city' ? open.city : null),
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
        partners={worldPartners}
        activePartner={null}
        link={link}
        world={mapWorld}
        selectedId={open ? placeSel : null}
        topExtra={open ? WORLD_TOP_PX : RINGS_H}
        focusKey={home ? sel : null}
        sunBrandSlug={sunBrand?.slug ?? null}
        pullSun={pullSun}
        visible={active}
        arrivalKey={arrivalKey}
        topInset={topInset}
        sheetPx={WORLD_BOTTOM_PX}
        peekPx={WORLD_BOTTOM_PX}
        pickMode={picking}
        draftPin={draftPin}
        onPick={p => { setDraftPin(p); setPicking(false); }}
        onViewChange={() => {}}
        onCityTap={c => selectPlace(`city:${c}`)}
        onPartnerTap={key => { if (places.some(p => p.key === `brand:${key}`)) selectPlace(`brand:${key}` as PlaceKey); }}
        onSunTap={() => { if (sunBrand) enterPlace(`brand:${sunBrand.slug}`); }}
        onPinTap={onPinTap}
      />

      {home && ready && (
        <>
          <StoryRings
            brands={brands}
            fresh={fresh}
            top={topInset}
            onPost={onPost}
            onOpen={slug => enterPlace(`brand:${slug}`)}
            pull={pull.handlers}
          />
          <PlaceCarousel
            places={orderedPlaces}
            status={status}
            now={now}
            selected={sel}
            run={arrived}
            animateReorder={animateReorder.current}
            onSelect={selectPlace}
            onOpen={key => enterPlace(key)}
            onPost={onPost}
            onOpenFeed={openFeedHome}
          />
        </>
      )}

      {home && !ready && <HomeSkeleton top={topInset} />}

      {placeView}

      {feed && (
        <SocialFeed
          title={feed.title}
          events={feed.events}
          startId={feed.startId}
          brandOf={brandOf}
          colorOf={ev => eventColor(theme, ev)}
          going={going}
          now={now}
          newSince={newSince}
          topInset={topInset}
          onGoing={onGoing}
          onClose={closeFeed}
        />
      )}

      <SocialToast toast={toast} onDone={() => setToast(null)} />

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

      {gateBrand && (
        <AgeGate
          brand={gateBrand}
          onYes={() => { setGateSlug(null); void enterWorld(gateBrand.slug, true); }}
          onNo={() => setGateSlug(null)}
        />
      )}

      {signedIn && (
        <PostFlow
          open={postOpen}
          topInset={topInset}
          canHost={canHost}
          isAdmin={me.role === 'admin'}
          termsAccepted={me.termsAccepted}
          hostName={me.name}
          brands={brands}
          defaultCity={open?.kind === 'city' ? open.city : open?.kind === 'brand' && open.city ? open.city : nearestCity(places.find(x => x.key === sel)?.center ?? SOCIAL_CITY_GEO.tampa.center)}
          picking={picking}
          droppedPin={draftPin}
          onPickOnMap={() => setPicking(true)}
          colorOf={ev => eventColor(theme, ev)}
          onAcceptTerms={async () => { const ok = await acceptTerms(profileId); if (ok) me.reload(); return ok; }}
          onSubmit={submit}
          onClose={() => { setPostOpen(false); setPicking(false); }}
        />
      )}
    </div>
  );
}
