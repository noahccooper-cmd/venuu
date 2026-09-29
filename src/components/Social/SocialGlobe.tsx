import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import mapboxgl from 'mapbox-gl';
import { MAPBOX_STYLE, type CityKey } from '../../lib/constants';
import { mapboxToken, mapboxReady } from '../../lib/supabase';
import type { SocialPartner, SocialTheme } from '../../lib/socialTheme';
import type { SocialEvent } from '../../lib/socialTypes';
import { SOCIAL_CITIES, SOCIAL_CITY_GEO, prefersReducedMotion } from '../../lib/socialGeo';
import { CityPin, PartnerPin } from './GlobePins';
import { SunBackdrop, SunLogo, type GlobeGeometry } from './SunBackdrop';

const FONT = 'Satoshi, sans-serif';

// Framed on the Southeast US: all three markets on screen at rest.
const WORLD_VIEW = { center: [-84.2, 30.4] as [number, number], zoom: 1.8, pitch: 0, bearing: 0 };
const MIN_ZOOM = 1.5;
const MAX_ZOOM = 2.4;
// Partner view pulls the globe back so the sun stays above the rim while
// the list sheet covers the lower half.
const PARTNER_ZOOM = 0.9;
const PARTNER_MIN_ZOOM = 0.4;

// Idle drift: ~1°/s westward spin; pauses on any touch, resumes after 4s.
const DRIFT_DEG_PER_S = 1;
const RESUME_AFTER_MS = 4000;

// Arrival choreography (ms): globe fades up, then pins light in turn.
const FADE_MS = 300;
const FIRST_LIGHT_MS = 250;
const STAGGER_MS = 120;
// Partner view: pins ignite in date order.
const IGNITE_DELAY_MS = 250;
const IGNITE_STAGGER_MS = 80;

// Far-side fade: full opacity inside FADE_START° of the view center,
// gone by FADE_END° (the horizon is ~90°).
const FADE_START = 65;
const FADE_END = 85;

// Parallax: the sun eases a few px opposite the drag.
const PARALLAX = 0.04;
const PARALLAX_MAX = 8;

const IGNITE_SOURCE = 'social-ignite';

interface SocialGlobeProps {
  theme: SocialTheme;
  counts: Record<CityKey, number>;
  /** Partners pinned on the globe (those with a `home`). */
  pinnedPartners: SocialPartner[];
  /** Presenting-partner view: its events ignite across every city. */
  partnerView: { partner: SocialPartner; events: SocialEvent[] } | null;
  /** Tab visible AND world screen showing — drives resize, reset, drift. */
  visible: boolean;
  /** Bumped each time Social opens → replay the arrival. */
  arrivalKey: number;
  /** Height reserved at the bottom by the partner sheet (px). */
  sheetHeight: number;
  onCityChosen: (city: CityKey) => void;
  onPartnerTap: (key: string) => void;
  onSunTap: () => void;
}

type PinKey = CityKey | `partner:${string}`;

/** Great-circle angle in degrees between two lng/lat points. */
function angleDeg(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180;
  const [lng1, lat1] = [a[0] * r, a[1] * r];
  const [lng2, lat2] = [b[0] * r, b[1] * r];
  const c = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
  return Math.acos(Math.min(1, Math.max(-1, c))) / r;
}

/** Disc center + radius on screen: project a point 80° north of center
 *  (front hemisphere), then undo the sine. Valid for any bearing. */
function measureGlobe(map: mapboxgl.Map): GlobeGeometry {
  const c = map.getCenter();
  const cp = map.project(c);
  let lat = c.lat + 80;
  let lng = c.lng;
  if (lat > 90) { lat = 180 - lat; lng += 180; }
  const p = map.project([lng, lat]);
  const r = Math.hypot(p.x - cp.x, p.y - cp.y) / Math.sin((80 * Math.PI) / 180);
  return { cx: cp.x, cy: cp.y, r };
}

/** Geometry before any map exists, so the sun paints on the very first
 *  frame. Radius = mercator world size / 2π, times a latitude correction
 *  calibrated against measureGlobe() at WORLD_VIEW (303px at 390×679);
 *  the real measurement replaces it as soon as the map is constructed. */
const GLOBE_RADIUS_CALIBRATION = 1.068;
function estimateGlobe(width: number, height: number, padTop: number): GlobeGeometry {
  const r = ((512 * Math.pow(2, WORLD_VIEW.zoom)) / (2 * Math.PI)) * GLOBE_RADIUS_CALIBRATION;
  return { cx: width / 2, cy: padTop + (height - padTop) / 2, r };
}

export function SocialGlobe({
  theme, counts, pinnedPartners, partnerView, visible, arrivalKey, sheetHeight,
  onCityChosen, onPartnerTap, onSunTap,
}: SocialGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [flying, setFlying] = useState<CityKey | null>(null);
  const reduced = prefersReducedMotion();
  // Arrival state: globe faded up + how many pins are lit.
  const [globeUp, setGlobeUp] = useState(reduced);
  const [litCount, setLitCount] = useState(reduced ? 99 : 0);
  // Globe geometry for the sun; container width for its size.
  const [geo, setGeo] = useState<GlobeGeometry | null>(null);
  const [width, setWidth] = useState(390);
  const [shift, setShift] = useState({ x: 0, y: 0 });
  // First-load silhouette stays until the globe's first fade-in completes.
  const [silhouetteDone, setSilhouetteDone] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  // One DOM element per pin, owned by a Mapbox marker so it turns with the globe.
  const [pinEls, setPinEls] = useState<Partial<Record<PinKey, HTMLDivElement>>>({});
  const pinCoords = useRef(new Map<PinKey, [number, number]>());
  const lastInputAt = useRef(0);
  const dragging = useRef(false);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const flyingRef = useRef(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const partnerRef = useRef(partnerView);
  partnerRef.current = partnerView;
  const sheetRef = useRef(sheetHeight);
  sheetRef.current = sheetHeight;
  const onCityChosenRef = useRef(onCityChosen);
  onCityChosenRef.current = onCityChosen;
  const pinElsRef = useRef<Partial<Record<PinKey, HTMLDivElement>>>({});
  const pinnedPartnersRef = useRef(pinnedPartners);
  pinnedPartnersRef.current = pinnedPartners;
  const hasSun = theme.sun !== null;

  /** Camera for the plain world view; with a sun, the globe sits lower to
   *  leave sky for it. */
  const worldCamera = useCallback((): mapboxgl.CameraOptions => {
    const h = wrapRef.current?.clientHeight ?? 700;
    return { ...WORLD_VIEW, padding: { top: hasSun ? Math.round(h * 0.3) : 0, bottom: 0, left: 0, right: 0 } };
  }, [hasSun]);

  const partnerCamera = useCallback((events: SocialEvent[]): mapboxgl.CameraOptions => {
    const h = wrapRef.current?.clientHeight ?? 700;
    const lngs = events.map(e => e.longitude);
    const lats = events.map(e => e.latitude);
    const center: [number, number] = lngs.length
      ? [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2]
      : WORLD_VIEW.center;
    return {
      center,
      zoom: hasSun ? PARTNER_ZOOM : 1.2,
      bearing: 0,
      pitch: 0,
      padding: { top: hasSun ? Math.round(h * 0.26) : 0, bottom: sheetRef.current, left: 0, right: 0 },
    };
  }, [hasSun]);

  // ── First frame: size + estimated geometry, before paint ──
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    setWidth(w);
    setGeo(estimateGlobe(w, h, hasSun ? Math.round(h * 0.3) : 0));
  }, [hasSun]);

  // ── Init once — deferred a frame so the sun and space paint first ──
  useEffect(() => {
    if (!containerRef.current || !mapboxReady) return;
    let map: mapboxgl.Map | null = null;
    const raf = requestAnimationFrame(() => { map = createMap(); });
    return () => {
      cancelAnimationFrame(raf);
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function createMap(): mapboxgl.Map | null {
    if (!containerRef.current) return null;
    mapboxgl.accessToken = mapboxToken;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAPBOX_STYLE,
      projection: { name: 'globe' },
      ...worldCamera(),
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      maxPitch: 0,                 // pitch fixed
      pitchWithRotate: false,
      doubleClickZoom: false,
      keyboard: false,
      attributionControl: false,
      antialias: false,
    });
    map.touchPitch.disable();
    // Calmer spin at globe zoom: a swipe shouldn't fling the planet around.
    map.dragPan.enable({ linearity: 0.3, maxSpeed: 700, deceleration: 4000 });
    mapRef.current = map;

    // Until the map has loaded, the first-frame estimate stands (measuring a
    // freshly constructed map reads it before its size/padding settle).
    let ready = false;
    const remeasure = () => {
      if (!ready) return;
      setGeo(measureGlobe(map));
      setWidth(wrapRef.current?.clientWidth ?? 390);
    };
    map.on('load', () => { ready = true; remeasure(); });
    map.on('move', remeasure);
    map.on('resize', remeasure);

    map.on('style.load', () => {
      map.setFog({
        color: theme.globe.fog,
        'high-color': theme.globe.highColor,
        'space-color': theme.globe.space,
        'horizon-blend': 0.04,
        'star-intensity': 0,
      });
      // Labels off — the pinned labels are the only text on the globe.
      for (const layer of map.getStyle()?.layers ?? []) {
        if (layer.type === 'symbol') map.setLayoutProperty(layer.id, 'visibility', 'none');
      }
    });

    // Any touch pauses the drift; it resumes RESUME_AFTER_MS after the last one.
    const touch = () => { lastInputAt.current = performance.now(); };
    const pointOf = (e: MouseEvent | TouchEvent | undefined) => {
      if (!e) return null;
      if ('touches' in e) return e.touches[0] ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
      return { x: e.clientX, y: e.clientY };
    };
    map.on('mousedown', touch);
    map.on('touchstart', touch);
    map.on('wheel', touch);
    map.on('dragstart', (e) => {
      dragging.current = true;
      setIsDragging(true);
      dragOrigin.current = pointOf(e.originalEvent as MouseEvent | TouchEvent);
      touch();
    });
    map.on('drag', (e) => {
      const o = dragOrigin.current;
      const p = pointOf(e.originalEvent as MouseEvent | TouchEvent);
      if (!o || !p) return;
      const clamp = (v: number) => Math.max(-PARALLAX_MAX, Math.min(PARALLAX_MAX, v));
      setShift({ x: clamp(-(p.x - o.x) * PARALLAX), y: clamp(-(p.y - o.y) * PARALLAX) });
    });
    map.on('dragend', () => {
      dragging.current = false;
      setIsDragging(false);
      dragOrigin.current = null;
      setShift({ x: 0, y: 0 });
      touch();
    });

    // Far-side fade: each pin's inner wrapper fades as it nears the horizon.
    const fadePins = () => {
      const c = map.getCenter();
      const center: [number, number] = [c.lng, c.lat];
      pinCoords.current.forEach((coord, key) => {
        const el = pinElsRef.current[key];
        const inner = el?.firstElementChild as HTMLElement | null;
        if (!inner) return;
        const d = angleDeg(center, coord);
        const o = d <= FADE_START ? 1 : d >= FADE_END ? 0 : (FADE_END - d) / (FADE_END - FADE_START);
        inner.style.opacity = String(o);
        inner.style.pointerEvents = o > 0.5 ? 'auto' : 'none';
      });
    };
    map.on('move', fadePins);

    map.on('load', () => {
      // Ignition layers for the partner view (empty until it opens).
      map.addSource(IGNITE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      const lit: mapboxgl.ExpressionSpecification = ['boolean', ['feature-state', 'lit'], false];
      const fade = reduced ? { duration: 0, delay: 0 } : { duration: 250, delay: 0 };
      map.addLayer({
        id: 'social-ignite-glow',
        type: 'circle',
        source: IGNITE_SOURCE,
        paint: {
          'circle-radius': 12,
          'circle-color': ['get', 'color'],
          'circle-blur': 1,
          'circle-opacity': ['case', lit, 0.6, 0],
          'circle-opacity-transition': fade,
        },
      });
      map.addLayer({
        id: 'social-ignite-core',
        type: 'circle',
        source: IGNITE_SOURCE,
        paint: {
          'circle-radius': 4,
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': ['get', 'secondary'],
          'circle-opacity': ['case', lit, 1, 0],
          'circle-stroke-opacity': ['case', lit, 1, 0],
          'circle-opacity-transition': fade,
          'circle-stroke-opacity-transition': fade,
        },
      });

      // Markers for cities + pinned partners.
      const els: Partial<Record<PinKey, HTMLDivElement>> = {};
      const add = (key: PinKey, coord: [number, number]) => {
        const el = document.createElement('div');
        const inner = document.createElement('div');   // fade target; React renders into it
        el.appendChild(inner);
        new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat(coord).addTo(map);
        pinCoords.current.set(key, coord);
        els[key] = inner;
      };
      for (const city of SOCIAL_CITIES) add(city, SOCIAL_CITY_GEO[city].center);
      for (const p of pinnedPartnersRef.current) if (p.home) add(`partner:${p.key}`, p.home);
      pinElsRef.current = Object.fromEntries(
        Object.entries(els).map(([k, inner]) => [k, inner!.parentElement as HTMLDivElement]),
      ) as Partial<Record<PinKey, HTMLDivElement>>;
      setPinEls(els);
      fadePins();
      setLoaded(true);
    });

    return map;
  }

  // ── Becoming visible (tab switch or back from a city): reset + resize ──
  useEffect(() => {
    if (!visible) return;
    const map = mapRef.current;
    if (!map) return;
    const raf = requestAnimationFrame(() => {
      map.resize();
      map.setMaxZoom(MAX_ZOOM);   // restore the globe-range lock after a fly-down
      const pv = partnerRef.current;
      map.jumpTo(pv ? partnerCamera(pv.events) : worldCamera());
      flyingRef.current = false;
      setFlying(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [visible, worldCamera, partnerCamera]);

  // ── Idle drift (never under reduced motion, never in partner view) ──
  useEffect(() => {
    if (reduced || !loaded) return;
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = (now - prev) / 1000;
      prev = now;
      const map = mapRef.current;
      const idle = now - lastInputAt.current > RESUME_AFTER_MS;
      if (map && visibleRef.current && idle && !partnerRef.current
          && !dragging.current && !flyingRef.current && !map.isMoving()) {
        const c = map.getCenter();
        map.setCenter([c.lng - DRIFT_DEG_PER_S * Math.min(dt, 0.1), c.lat]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loaded, reduced]);

  // ── Arrival: fade up from black, light pins one at a time ──
  useEffect(() => {
    if (reduced) return;
    setGlobeUp(false);
    setLitCount(0);
    if (!loaded) return;
    const timers: number[] = [];
    const raf = requestAnimationFrame(() => setGlobeUp(true));
    const total = SOCIAL_CITIES.length + pinnedPartners.length;
    for (let i = 0; i < total; i++) {
      timers.push(window.setTimeout(() => setLitCount(i + 1), FIRST_LIGHT_MS + i * STAGGER_MS));
    }
    // A fresh arrival starts drifting only after the user has had a moment.
    lastInputAt.current = performance.now();
    return () => { cancelAnimationFrame(raf); timers.forEach(t => window.clearTimeout(t)); };
  }, [arrivalKey, loaded, reduced, pinnedPartners.length]);

  useEffect(() => {
    if (silhouetteDone || !loaded || !globeUp) return;
    const t = window.setTimeout(() => setSilhouetteDone(true), reduced ? 0 : FADE_MS + 50);
    return () => window.clearTimeout(t);
  }, [loaded, globeUp, silhouetteDone, reduced]);

  // ── Partner view: turn to the partner's events, ignite them in date order ──
  const partnerKey = partnerView?.partner.key ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const src = map.getSource(IGNITE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    const pv = partnerRef.current;
    const timers: number[] = [];

    if (!pv) {
      src?.setData({ type: 'FeatureCollection', features: [] });
      map.setMinZoom(PARTNER_MIN_ZOOM);          // allow the ease back out from partner zoom
      map.easeTo({ ...worldCamera(), duration: reduced ? 0 : 700 });
      map.once('moveend', () => map.setMinZoom(MIN_ZOOM));
      return;
    }

    const ordered = [...pv.events].sort((a, b) => a.start_time.localeCompare(b.start_time));
    src?.setData({
      type: 'FeatureCollection',
      features: ordered.map((ev, i) => ({
        type: 'Feature',
        id: i,
        geometry: { type: 'Point', coordinates: [ev.longitude, ev.latitude] },
        properties: { color: pv.partner.color, secondary: pv.partner.secondary ?? pv.partner.color },
      })),
    });
    map.setMinZoom(PARTNER_MIN_ZOOM);
    map.easeTo({ ...partnerCamera(ordered), duration: reduced ? 0 : 700, essential: true });
    ordered.forEach((_, i) => {
      if (reduced) {
        map.setFeatureState({ source: IGNITE_SOURCE, id: i }, { lit: true });
        return;
      }
      timers.push(window.setTimeout(() => {
        if (map.getSource(IGNITE_SOURCE)) map.setFeatureState({ source: IGNITE_SOURCE, id: i }, { lit: true });
      }, IGNITE_DELAY_MS + i * IGNITE_STAGGER_MS));
    });
    return () => timers.forEach(t => window.clearTimeout(t));
    // partner events are read via ref; the key is the trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerKey, loaded]);

  const choose = useCallback((city: CityKey) => {
    const map = mapRef.current;
    if (!map || flyingRef.current) return;
    if (reduced) {
      onCityChosenRef.current(city);
      return;
    }
    flyingRef.current = true;
    setFlying(city);
    map.once('moveend', () => onCityChosenRef.current(city));
    map.setMaxZoom(10);           // lifted only for the fly-down into a city
    map.flyTo({ center: SOCIAL_CITY_GEO[city].center, zoom: 9.5, duration: 1800, curve: 1.4, essential: true });
  }, [reduced]);

  const pinsLit = (i: number) => litCount > i && flying === null && !partnerView;

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0, background: theme.sun ? '#050403' : '#000', overflow: 'hidden' }}>
      {theme.sun && geo && (
        <SunBackdrop geo={geo} width={width} colors={theme.sun} shift={shift} dragging={isDragging} reduced={reduced} />
      )}

      {/* Globe silhouette for the first frames: occludes the sun's lower half
          exactly where the planet will be, until the real globe has faded in. */}
      {theme.sun && geo && !silhouetteDone && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: geo.cx - geo.r, top: geo.cy - geo.r, width: geo.r * 2, height: geo.r * 2,
            borderRadius: '50%', background: '#1B1B1B',
            boxShadow: `0 0 24px 2px ${theme.sun.corona}`,
          }}
        />
      )}

      <div
        ref={containerRef}
        style={{
          position: 'absolute', inset: 0,
          opacity: globeUp ? 1 : 0,
          transition: reduced ? 'none' : `opacity ${FADE_MS}ms ease-out`,
        }}
      />

      {theme.sun && theme.presentedBy && geo && (
        <SunLogo
          geo={geo}
          width={width}
          logo={theme.presentedBy.logo}
          name={theme.presentedBy.name}
          shift={shift}
          dragging={isDragging}
          reduced={reduced}
          active={!!partnerView}
          onTap={onSunTap}
        />
      )}

      {!mapboxReady && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: FONT, color: 'var(--text-secondary)', fontSize: 13 }}>
          Map requires VITE_MAPBOX_TOKEN
        </div>
      )}

      {SOCIAL_CITIES.map((city, i) => {
        const el = pinEls[city];
        return el ? createPortal(
          <CityPin
            city={city}
            count={counts[city] ?? 0}
            lit={pinsLit(i)}
            reduced={reduced}
            onTap={() => choose(city)}
          />,
          el,
          city,
        ) : null;
      })}
      {pinnedPartners.map((p, i) => {
        const el = pinEls[`partner:${p.key}`];
        return el ? createPortal(
          <PartnerPin
            partner={p}
            lit={pinsLit(SOCIAL_CITIES.length + i)}
            reduced={reduced}
            onTap={() => onPartnerTap(p.key)}
          />,
          el,
          p.key,
        ) : null;
      })}
    </div>
  );
}
