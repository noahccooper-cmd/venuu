import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import mapboxgl from 'mapbox-gl';
import { MAPBOX_STYLE, type CityKey } from '../../lib/constants';
import { mapboxToken, mapboxReady } from '../../lib/supabase';
import { hapticLight } from '../../lib/haptics';
import {
  brandPartnerFor, eventColor, partnerMatches, type SocialPartner, type SocialTheme,
} from '../../lib/socialTheme';
import type { SocialEvent } from '../../lib/socialTypes';
import {
  SOCIAL_CITIES, SOCIAL_CITY_GEO, boundsOf, distanceKm, prefersReducedMotion,
} from '../../lib/socialGeo';
import { applySunWorldPaint } from '../../lib/socialMapStyle';
import {
  CityPin, PartnerPin, CITY_OFFSETS, PARTNER_OFFSET, LABEL_W, LABEL_H, MEDALLION_SIZE, type PinOffset,
} from './GlobePins';
import { SunBackdrop, SunButton, type GlobeGeometry } from './SunBackdrop';

const FONT = 'Satoshi, sans-serif';

// ── Camera ────────────────────────────────────────────────────────
const WORLD_CENTER: [number, number] = [-84.2, 30.4];
const WORLD_ZOOM = 1.5;
const MIN_ZOOM = 1.2;
const MAX_ZOOM = 17;
const DRIFT_MAX_ZOOM = 3;          // idle drift only at globe zoom
const DRIFT_DEG_PER_S = 1;
const RESUME_AFTER_MS = 4000;

// ── Fades by zoom ─────────────────────────────────────────────────
const LABELS_FULL_UNTIL = 6.5;     // city labels + medallions fade out 6.5 → 8
const LABELS_GONE_AT = 8;
const PINS_START = 8.5;            // event pins fade in 8.5 → 9.5
const PINS_FULL = 9.5;
const GLOBE_GEOMETRY_MAX_ZOOM = 4.5;

// ── Arrival ───────────────────────────────────────────────────────
const FADE_MS = 300;
const FIRST_LIGHT_MS = 250;
const STAGGER_MS = 120;
const IGNITE_STAGGER_MS = 80;

// Far-side fade: full opacity within FADE_START° of view center.
const FADE_START = 65;
const FADE_END = 85;

const PARALLAX = 0.04;
const PARALLAX_MAX = 8;

const PIN_RADIUS = 7;
const HIT = 22;                    // ±22px → 44pt hit area for map pins
const LINK_MS = 1500;
const PULSE_CYCLES = 2;
const PULSE_MS = 700;
const FAN_MAX = 6;
const FAN_RADIUS = 52;
const FAN_SIZE = 44;

const SOURCE = 'social-events';
const PULSE_SOURCE = 'social-pulse';
const DRAFT_SOURCE = 'social-draft';

export interface SocialLink { id: string; nonce: number; source: 'card' | 'pin' | 'post' }

export interface CameraSnapshot {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
  padding: mapboxgl.PaddingOptions;
}

export interface SocialMapHandle {
  flyToWorld(): void;
  /** `sheetPx`: the sheet height the flight should clear (defaults to current). */
  flyToCity(city: CityKey, events: SocialEvent[], sheetPx?: number): void;
  flyToEvent(ev: SocialEvent, sheetPx?: number): void;
  fitPoints(points: [number, number][], maxZoom?: number, sheetPx?: number): void;
  getCamera(): CameraSnapshot | null;
  setCamera(cam: CameraSnapshot): void;
  /** Sun Cruiser World: ignite the partner's pins nearest-first from origin. */
  ignite(origin: [number, number]): void;
}

interface SocialMapProps {
  theme: SocialTheme;
  events: SocialEvent[];
  counts: Record<CityKey, number>;
  pinnedPartners: SocialPartner[];
  /** Partners used to key pins for filtering (the city's medallions). */
  partners: SocialPartner[];
  activePartner: string | null;
  link: SocialLink | null;
  /** Sun Cruiser World on/off. */
  sunWorld: boolean;
  visible: boolean;
  arrivalKey: number;
  topInset: number;
  /** Current sheet height — flights keep their subject above it. */
  sheetPx: number;
  peekPx: number;
  pickMode: boolean;
  draftPin: [number, number] | null;
  onPick: (p: [number, number]) => void;
  onViewChange: (v: { zoom: number; center: [number, number] }) => void;
  onCityTap: (city: CityKey) => void;
  onPartnerTap: (key: string) => void;
  onSunTap: () => void;
  onPinTap: (id: string) => void;
}

type PinKey = CityKey | `partner:${string}`;

function angleDeg(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180;
  const c = Math.sin(a[1] * r) * Math.sin(b[1] * r)
    + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
  return Math.acos(Math.min(1, Math.max(-1, c))) / r;
}

/** Disc center + radius on screen at globe zoom (valid for any bearing). */
function measureGlobe(map: mapboxgl.Map): GlobeGeometry {
  const c = map.getCenter();
  const cp = map.project(c);
  let lat = c.lat + 80;
  let lng = c.lng;
  if (lat > 90) { lat = 180 - lat; lng += 180; }
  const p = map.project([lng, lat]);
  return { cx: cp.x, cy: cp.y, r: Math.hypot(p.x - cp.x, p.y - cp.y) / Math.sin((80 * Math.PI) / 180) };
}

// Radius = mercator world size / 2π × a latitude correction calibrated
// against measureGlobe() at the world view; replaced once the map loads.
const GLOBE_RADIUS_CALIBRATION = 1.068;
function estimateGlobe(width: number, height: number, padTop: number, padBottom: number): GlobeGeometry {
  const r = ((512 * Math.pow(2, WORLD_ZOOM)) / (2 * Math.PI)) * GLOBE_RADIUS_CALIBRATION;
  return { cx: width / 2, cy: padTop + (height - padTop - padBottom) / 2, r };
}

/** Would a label poke past the limb (globe zoom) or the screen edge? */
function hangsOff(
  x: number, y: number, off: PinOffset, w: number, h: number, g: GlobeGeometry | null, viewW: number, viewH: number,
): boolean {
  const ex = x + off.dx;
  const ey = y + off.dy;
  const corners: [number, number][] =
    off.align === 'left'  ? [[ex + w, ey - h / 2], [ex + w, ey + h / 2]] :
    off.align === 'right' ? [[ex - w, ey - h / 2], [ex - w, ey + h / 2]] :
    off.dy < 0            ? [[ex - w / 2, ey - h], [ex + w / 2, ey - h]] :
                            [[ex - w / 2, ey + h], [ex + w / 2, ey + h]];
  return corners.some(([cx, cy]) =>
    (g !== null && Math.hypot(cx - g.cx, cy - g.cy) > g.r - 4) || cx < 0 || cx > viewW || cy < 0 || cy > viewH);
}

const zoomIn = (inner: mapboxgl.ExpressionSpecification | number): mapboxgl.ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], PINS_START, 0, PINS_FULL, inner];

interface FanItem { id: string; color: string; day: number }

export const SocialMap = forwardRef<SocialMapHandle, SocialMapProps>(function SocialMap(props, ref) {
  const {
    theme, events, counts, pinnedPartners, partners, activePartner, link, sunWorld,
    visible, arrivalKey, topInset, peekPx, pickMode, draftPin,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const reduced = prefersReducedMotion();
  const [loaded, setLoaded] = useState(false);
  const [globeUp, setGlobeUp] = useState(reduced);
  const [silhouetteDone, setSilhouetteDone] = useState(false);
  const [litCount, setLitCount] = useState(reduced ? 99 : 0);
  const [geo, setGeo] = useState<GlobeGeometry | null>(null);
  const [zoom, setZoom] = useState(WORLD_ZOOM);
  const [width, setWidth] = useState(390);
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [pinEls, setPinEls] = useState<Partial<Record<PinKey, HTMLDivElement>>>({});
  const [flips, setFlips] = useState<Partial<Record<PinKey, boolean>>>({});
  const [fan, setFan] = useState<{ x: number; y: number; items: FanItem[] } | null>(null);
  const flipsRef = useRef(flips);
  const pinElsRef = useRef<Partial<Record<PinKey, HTMLDivElement>>>({});
  const pinCoords = useRef(new Map<PinKey, [number, number]>());
  const lastInputAt = useRef(0);
  const dragging = useRef(false);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const pulseFrame = useRef(0);
  const restorePaint = useRef<(() => void) | null>(null);
  const igniteTimers = useRef<number[]>([]);

  // Latest props for map event handlers (registered once).
  const latest = useRef(props);
  latest.current = props;

  const hasSun = theme.sun !== null;
  const presenterBrand = theme.presentedBy
    ? theme.partners.find(p => p.key === theme.presentedBy!.partnerKey)?.match.brand ?? null
    : null;

  const worldPadding = useCallback((): mapboxgl.PaddingOptions => ({
    top: topInset + (hasSun ? 110 : 40), bottom: peekPx + 8, left: 0, right: 0,
  }), [topInset, hasSun, peekPx]);

  const flightPadding = useCallback((sheet?: number): mapboxgl.PaddingOptions => ({
    top: topInset + 24, bottom: (sheet ?? latest.current.sheetPx) + 24, left: 32, right: 32,
  }), [topInset]);

  // ── Imperative camera API ──
  useImperativeHandle(ref, () => ({
    flyToWorld() {
      const map = mapRef.current;
      if (!map) return;
      map.flyTo({ center: WORLD_CENTER, zoom: WORLD_ZOOM, bearing: 0, pitch: 0, padding: worldPadding(), duration: reduced ? 0 : 1500, essential: true });
    },
    flyToCity(city, cityEvents, sheet) {
      const map = mapRef.current;
      if (!map) return;
      const b = boundsOf(cityEvents.map(e => [e.longitude, e.latitude] as [number, number]));
      if (b && cityEvents.length > 1) {
        map.fitBounds(b, { padding: flightPadding(sheet), maxZoom: 13, duration: reduced ? 0 : 1800, essential: true });
      } else {
        const g = SOCIAL_CITY_GEO[city];
        map.flyTo({ center: g.center, zoom: 11, padding: flightPadding(sheet), duration: reduced ? 0 : 1800, essential: true });
      }
    },
    flyToEvent(ev, sheet) {
      const map = mapRef.current;
      if (!map) return;
      map.flyTo({
        center: [ev.longitude, ev.latitude], zoom: Math.max(map.getZoom(), 14),
        padding: flightPadding(sheet), duration: reduced ? 0 : 900, essential: true,
      });
    },
    fitPoints(points, maxZoom = 13, sheet) {
      const map = mapRef.current;
      const b = boundsOf(points);
      if (!map || !b) return;
      map.fitBounds(b, { padding: flightPadding(sheet), maxZoom, duration: reduced ? 0 : 1600, essential: true });
    },
    getCamera() {
      const map = mapRef.current;
      if (!map) return null;
      const c = map.getCenter();
      return { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), padding: map.getPadding() };
    },
    setCamera(cam) {
      mapRef.current?.flyTo({ ...cam, duration: reduced ? 0 : 1200, essential: true });
    },
    ignite(origin) {
      const map = mapRef.current;
      if (!map) return;
      igniteTimers.current.forEach(t => window.clearTimeout(t));
      igniteTimers.current = [];
      const brandEvents = latest.current.events.filter(e => e.brand === presenterBrand);
      for (const e of brandEvents) map.setFeatureState({ source: SOURCE, id: e.id }, { lit: false });
      const ordered = [...brandEvents].sort((a, b) =>
        distanceKm(origin, [a.longitude, a.latitude]) - distanceKm(origin, [b.longitude, b.latitude]));
      ordered.forEach((e, i) => {
        const fire = () => { if (map.getSource(SOURCE)) map.setFeatureState({ source: SOURCE, id: e.id }, { lit: true }); };
        if (reduced) fire();
        else igniteTimers.current.push(window.setTimeout(fire, 300 + i * IGNITE_STAGGER_MS));
      });
    },
  }), [worldPadding, flightPadding, reduced, presenterBrand]);

  // ── First frame: size + estimated globe geometry, before paint ──
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    const pad = worldPadding();
    setWidth(w);
    setGeo(estimateGlobe(w, h, pad.top ?? 0, pad.bottom ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Init once, a frame after first paint so space + sun show first ──
  useEffect(() => {
    if (!containerRef.current || !mapboxReady) return;
    let map: mapboxgl.Map | null = null;
    const raf = requestAnimationFrame(() => { map = createMap(); });
    return () => {
      cancelAnimationFrame(raf);
      igniteTimers.current.forEach(t => window.clearTimeout(t));
      cancelAnimationFrame(pulseFrame.current);
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toGeoJSON(evs: SocialEvent[]): GeoJSON.FeatureCollection {
    const { theme: th, partners: ps } = latest.current;
    return {
      type: 'FeatureCollection',
      features: evs.map(ev => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [ev.longitude, ev.latitude] },
        properties: {
          id: ev.id,
          start: new Date(ev.start_time).getTime(),
          color: eventColor(th, ev),
          secondary: brandPartnerFor(th, ev)?.secondary ?? '',
          day: new Date(ev.start_time).getDate(),
          brand: ev.brand ?? '',
          partner: ps.find(p => partnerMatches(p, ev))?.key ?? '',
        },
      })),
    };
  }

  function createMap(): mapboxgl.Map | null {
    if (!containerRef.current) return null;
    mapboxgl.accessToken = mapboxToken;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAPBOX_STYLE,
      projection: { name: 'globe' },   // Mapbox eases globe → flat as you zoom in
      center: WORLD_CENTER,
      zoom: WORLD_ZOOM,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      maxPitch: 0,
      pitchWithRotate: false,
      doubleClickZoom: true,
      keyboard: false,
      attributionControl: false,
      antialias: false,
    });
    map.setPadding(worldPadding());
    map.touchPitch.disable();
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.dragPan.enable({ linearity: 0.3, maxSpeed: 700, deceleration: 4000 });
    mapRef.current = map;

    let ready = false;
    const remeasure = () => {
      if (!ready) return;
      const z = map.getZoom();
      setZoom(z);
      if (z < GLOBE_GEOMETRY_MAX_ZOOM) setGeo(measureGlobe(map));
      setWidth(wrapRef.current?.clientWidth ?? 390);
    };
    map.on('move', remeasure);
    map.on('resize', remeasure);
    map.on('movestart', () => setFan(null));
    map.on('moveend', () => {
      const c = map.getCenter();
      latest.current.onViewChange({ zoom: map.getZoom(), center: [c.lng, c.lat] });
    });

    map.on('style.load', () => {
      const th = latest.current.theme;
      map.setFog({
        color: th.globe.fog,
        'high-color': th.globe.highColor,
        'space-color': th.globe.space,
        'horizon-blend': 0.04,
        'star-intensity': 0,
      });
      // Globe-scale labels (countries, states, oceans) and POIs off — the
      // city labels are the globe's only text; road + settlement labels stay
      // for reading a city once you're zoomed in.
      for (const layer of map.getStyle()?.layers ?? []) {
        if (layer.type === 'symbol' && /poi|country|continent|state|marine|water-point|water-line/.test(layer.id)) {
          map.setLayoutProperty(layer.id, 'visibility', 'none');
        }
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
      const c = (v: number) => Math.max(-PARALLAX_MAX, Math.min(PARALLAX_MAX, v));
      setShift({ x: c(-(p.x - o.x) * PARALLAX), y: c(-(p.y - o.y) * PARALLAX) });
    });
    map.on('dragend', () => {
      dragging.current = false;
      setIsDragging(false);
      dragOrigin.current = null;
      setShift({ x: 0, y: 0 });
      touch();
    });

    // Labels: far-side fade × zoom fade, and flip inward near an edge.
    const updatePins = () => {
      const z = map.getZoom();
      const c = map.getCenter();
      const center: [number, number] = [c.lng, c.lat];
      const g = z < GLOBE_GEOMETRY_MAX_ZOOM ? measureGlobe(map) : null;
      const box = map.getContainer();
      const zoomFade = z <= LABELS_FULL_UNTIL ? 1 : z >= LABELS_GONE_AT ? 0 : (LABELS_GONE_AT - z) / (LABELS_GONE_AT - LABELS_FULL_UNTIL);
      let changed = false;
      const next = { ...flipsRef.current };
      pinCoords.current.forEach((coord, key) => {
        const el = pinElsRef.current[key];
        const inner = el?.firstElementChild as HTMLElement | null;
        if (!inner) return;
        const d = angleDeg(center, coord);
        const far = d <= FADE_START ? 1 : d >= FADE_END ? 0 : (FADE_END - d) / (FADE_END - FADE_START);
        const o = far * zoomFade;
        inner.style.opacity = String(o);
        inner.style.pointerEvents = o > 0.5 ? 'auto' : 'none';
        if (o === 0) return;
        const p = map.project(coord);
        const isPartner = key.startsWith('partner:');
        const base = isPartner ? PARTNER_OFFSET : CITY_OFFSETS[key as CityKey];
        const btn = el?.querySelector('button');
        const w = btn ? btn.offsetWidth - (isPartner ? 0 : 8) : (isPartner ? MEDALLION_SIZE : LABEL_W);
        const h = btn ? btn.offsetHeight : (isPartner ? MEDALLION_SIZE : LABEL_H);
        const flip = hangsOff(p.x, p.y, base, w, h, g, box.clientWidth, box.clientHeight);
        if (!!next[key] !== flip) { next[key] = flip; changed = true; }
      });
      if (changed) { flipsRef.current = next; setFlips(next); }
    };
    map.on('move', updatePins);

    map.on('load', () => {
      map.addSource(SOURCE, { type: 'geojson', data: toGeoJSON(latest.current.events), promoteId: 'id' });
      map.addSource(PULSE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource(DRAFT_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      const fade = reduced ? { duration: 0, delay: 0 } : { duration: 250, delay: 0 };

      map.addLayer({
        id: 'social-glow', type: 'circle', source: SOURCE,
        paint: { 'circle-radius': 16, 'circle-color': ['get', 'color'], 'circle-blur': 0.7, 'circle-opacity': 0, 'circle-opacity-transition': fade },
      });
      map.addLayer({
        id: 'social-link', type: 'circle', source: SOURCE, filter: ['==', ['get', 'id'], ''],
        paint: { 'circle-radius': 20, 'circle-color': ['get', 'color'], 'circle-blur': 0.6, 'circle-opacity': 0.7 },
      });
      map.addLayer({
        id: 'social-pulse', type: 'circle', source: PULSE_SOURCE,
        paint: { 'circle-radius': PIN_RADIUS, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 2, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-opacity': 0 },
      });
      // Medallion pins: signal-color ring around a dark center; branded
      // events add a center dot in the brand's secondary.
      map.addLayer({
        id: 'social-pins', type: 'circle', source: SOURCE,
        paint: {
          'circle-radius': PIN_RADIUS, 'circle-color': '#0B0A09',
          'circle-stroke-width': 2.5, 'circle-stroke-color': ['get', 'color'],
          'circle-opacity-transition': fade, 'circle-stroke-opacity-transition': fade,
        },
      });
      map.addLayer({
        id: 'social-pin-dot', type: 'circle', source: SOURCE, filter: ['!=', ['get', 'secondary'], ''],
        paint: { 'circle-radius': 2.5, 'circle-color': ['get', 'secondary'], 'circle-opacity-transition': fade },
      });
      map.addLayer({
        id: 'social-draft-ring', type: 'circle', source: DRAFT_SOURCE,
        paint: { 'circle-radius': 10, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 2, 'circle-stroke-color': '#FFFFFF' },
      });
      map.addLayer({
        id: 'social-draft-dot', type: 'circle', source: DRAFT_SOURCE,
        paint: { 'circle-radius': 3, 'circle-color': '#FFFFFF' },
      });
      applyPinStyle(map, latest.current.sunWorld, latest.current.activePartner, presenterBrand);

      // Taps: pick mode → drop the draft pin; else pins within ±22px
      // (44pt) — one links, several fan out.
      map.on('click', (e) => {
        const cur = latest.current;
        if (cur.pickMode) { hapticLight(); cur.onPick([e.lngLat.lng, e.lngLat.lat]); return; }
        if (!cur.sunWorld && map.getZoom() < PINS_START) { setFan(null); return; }
        const { x, y } = e.point;
        const hits = map.queryRenderedFeatures([[x - HIT, y - HIT], [x + HIT, y + HIT]], { layers: ['social-pins'] })
          .filter(f => !cur.sunWorld || !!map.getFeatureState({ source: SOURCE, id: f.properties?.id })?.lit);
        const seen = new Set<string>();
        const items: FanItem[] = [];
        for (const f of hits.sort((a, b) => Number(a.properties?.start) - Number(b.properties?.start))) {
          const id = f.properties?.id;
          if (typeof id !== 'string' || seen.has(id)) continue;
          seen.add(id);
          items.push({ id, color: String(f.properties?.color), day: Number(f.properties?.day) });
        }
        if (items.length === 0) { setFan(null); return; }
        hapticLight();
        if (items.length === 1) { setFan(null); cur.onPinTap(items[0].id); return; }
        setFan({ x, y, items: items.slice(0, FAN_MAX) });
      });

      // Markers for city labels + pinned partner medallions.
      const els: Partial<Record<PinKey, HTMLDivElement>> = {};
      const add = (key: PinKey, coord: [number, number]) => {
        const el = document.createElement('div');
        const inner = document.createElement('div');
        el.appendChild(inner);
        new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat(coord).addTo(map);
        pinCoords.current.set(key, coord);
        els[key] = inner;
      };
      for (const city of SOCIAL_CITIES) add(city, SOCIAL_CITY_GEO[city].center);
      for (const p of latest.current.pinnedPartners) if (p.home) add(`partner:${p.key}`, p.home);
      pinElsRef.current = Object.fromEntries(
        Object.entries(els).map(([k, inner]) => [k, inner!.parentElement as HTMLDivElement]),
      ) as Partial<Record<PinKey, HTMLDivElement>>;
      setPinEls(els);
      ready = true;
      remeasure();
      updatePins();
      setLoaded(true);
    });
    return map;
  }

  // ── Data ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource(SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData(toGeoJSON(events));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, partners, loaded]);

  // ── Pin styling: normal (zoom fade + partner dimming) vs Sun Cruiser World ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    applyPinStyle(map, sunWorld, activePartner, presenterBrand);
  }, [sunWorld, activePartner, loaded, presenterBrand]);

  // ── Sun Cruiser World paint (Social map only), restored on exit ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    if (sunWorld) {
      restorePaint.current = applySunWorldPaint(map, reduced ? 0 : 400);
    } else if (restorePaint.current) {
      restorePaint.current();
      restorePaint.current = null;
      igniteTimers.current.forEach(t => window.clearTimeout(t));
      for (const e of latest.current.events) map.setFeatureState({ source: SOURCE, id: e.id }, { lit: false });
    }
  }, [sunWorld, loaded, reduced]);

  // ── Resize when the tab comes back ──
  useEffect(() => {
    if (!visible) return;
    const raf = requestAnimationFrame(() => mapRef.current?.resize());
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  // ── Idle drift: globe zoom only, never under reduced motion or in SCW ──
  useEffect(() => {
    if (reduced || !loaded) return;
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = (now - prev) / 1000;
      prev = now;
      const map = mapRef.current;
      const cur = latest.current;
      if (map && cur.visible && !cur.sunWorld && map.getZoom() < DRIFT_MAX_ZOOM
          && now - lastInputAt.current > RESUME_AFTER_MS && !dragging.current && !map.isMoving()) {
        const c = map.getCenter();
        map.setCenter([c.lng - DRIFT_DEG_PER_S * Math.min(dt, 0.1), c.lat]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loaded, reduced]);

  // ── Arrival: fade up from space, light labels one at a time ──
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
    lastInputAt.current = performance.now();
    return () => { cancelAnimationFrame(raf); timers.forEach(t => window.clearTimeout(t)); };
  }, [arrivalKey, loaded, reduced, pinnedPartners.length]);

  useEffect(() => {
    if (silhouetteDone || !loaded || !globeUp) return;
    const t = window.setTimeout(() => setSilhouetteDone(true), reduced ? 0 : FADE_MS + 50);
    return () => window.clearTimeout(t);
  }, [loaded, globeUp, silhouetteDone, reduced]);

  // ── Linked highlight: pin glows with its card; card/post flies + pulses ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !link || !loaded) return;
    const ev = latest.current.events.find(e => e.id === link.id);
    if (!ev) return;
    const timers: number[] = [];
    map.setFilter('social-link', ['==', ['get', 'id'], ev.id]);
    timers.push(window.setTimeout(() => {
      if (map.getLayer('social-link')) map.setFilter('social-link', ['==', ['get', 'id'], '']);
    }, LINK_MS));
    cancelAnimationFrame(pulseFrame.current);
    if (link.source !== 'pin') {
      (map.getSource(PULSE_SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [ev.longitude, ev.latitude] }, properties: { color: eventColor(latest.current.theme, ev) } }],
      });
      if (reduced) {
        map.setPaintProperty('social-pulse', 'circle-radius', PIN_RADIUS + 6);
        map.setPaintProperty('social-pulse', 'circle-stroke-opacity', 0.9);
        timers.push(window.setTimeout(() => {
          if (map.getLayer('social-pulse')) map.setPaintProperty('social-pulse', 'circle-stroke-opacity', 0);
        }, LINK_MS));
      } else {
        const t0 = performance.now() + 700;   // let the fly-to mostly settle
        const tick = (t: number) => {
          if (!map.getLayer('social-pulse')) return;
          const el = t - t0;
          if (el < 0) { pulseFrame.current = requestAnimationFrame(tick); return; }
          if (el >= PULSE_CYCLES * PULSE_MS) { map.setPaintProperty('social-pulse', 'circle-stroke-opacity', 0); return; }
          const p = (el % PULSE_MS) / PULSE_MS;
          map.setPaintProperty('social-pulse', 'circle-radius', PIN_RADIUS + p * 14);
          map.setPaintProperty('social-pulse', 'circle-stroke-opacity', 0.9 * (1 - p));
          pulseFrame.current = requestAnimationFrame(tick);
        };
        pulseFrame.current = requestAnimationFrame(tick);
      }
    }
    return () => { timers.forEach(t => window.clearTimeout(t)); cancelAnimationFrame(pulseFrame.current); };
  }, [link, loaded, reduced]);

  // ── Host demo: draft pin + crosshair ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource(DRAFT_SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: draftPin ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: draftPin }, properties: {} }] : [],
    });
  }, [draftPin, loaded]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = pickMode ? 'crosshair' : '';
    if (pickMode) setFan(null);
  }, [pickMode]);

  const labelsLit = (i: number) => litCount > i && !sunWorld;

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0, background: hasSun ? '#050403' : theme.globe.space, overflow: 'hidden' }}>
      {theme.sun && geo && (
        <SunBackdrop geo={geo} zoom={zoom} width={width} topInset={topInset} colors={theme.sun} shift={shift} dragging={isDragging} reduced={reduced} />
      )}

      {/* First-load silhouette: the planet's shape before tiles arrive, so
          the first frame is space + globe (+ sun), never plain black. */}
      {geo && !silhouetteDone && (
        <div
          aria-hidden
          style={{
            position: 'absolute', left: geo.cx - geo.r, top: geo.cy - geo.r, width: geo.r * 2, height: geo.r * 2,
            borderRadius: '50%', background: '#1B1B1B',
            boxShadow: theme.sun ? `0 0 24px 2px ${theme.sun.corona}` : '0 0 24px 2px rgba(60, 60, 80, 0.5)',
          }}
        />
      )}

      <div
        ref={containerRef}
        style={{ position: 'absolute', inset: 0, opacity: globeUp ? 1 : 0, transition: reduced ? 'none' : `opacity ${FADE_MS}ms ease-out` }}
      />

      {theme.sun && theme.presentedBy && geo && (
        <SunButton
          geo={geo} zoom={zoom} width={width} topInset={topInset}
          colors={theme.sun} logo={theme.presentedBy.logo} name={theme.presentedBy.name}
          shift={shift} dragging={isDragging} reduced={reduced} active={sunWorld}
          onTap={props.onSunTap}
        />
      )}

      {fan && <PinFan fan={fan} onPick={id => { setFan(null); props.onPinTap(id); }} />}

      {!mapboxReady && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: FONT, color: 'var(--text-secondary)', fontSize: 13 }}>
          Map requires VITE_MAPBOX_TOKEN
        </div>
      )}

      {SOCIAL_CITIES.map((city, i) => {
        const el = pinEls[city];
        return el ? createPortal(
          <CityPin city={city} count={counts[city] ?? 0} lit={labelsLit(i)} reduced={reduced} flipped={!!flips[city]} onTap={() => props.onCityTap(city)} />,
          el,
          city,
        ) : null;
      })}
      {pinnedPartners.map((p, i) => {
        const el = pinEls[`partner:${p.key}`];
        return el ? createPortal(
          <PartnerPin partner={p} lit={labelsLit(SOCIAL_CITIES.length + i)} reduced={reduced} flipped={!!flips[`partner:${p.key}`]} onTap={() => props.onPartnerTap(p.key)} />,
          el,
          p.key,
        ) : null;
      })}
    </div>
  );
});

/** Pin paint for the current mode. Normal: pins fade in with zoom and a
 *  selected partner's pins glow while the rest dim. Sun Cruiser World: only
 *  the presenter's pins, shown as they ignite (feature-state `lit`). */
function applyPinStyle(map: mapboxgl.Map, sunWorld: boolean, active: string | null, brand: string | null) {
  const lit: mapboxgl.ExpressionSpecification = ['boolean', ['feature-state', 'lit'], false];
  const brandFilter: mapboxgl.FilterSpecification = ['==', ['get', 'brand'], brand ?? '__none__'];
  if (sunWorld) {
    for (const id of ['social-pins', 'social-pin-dot', 'social-glow']) {
      map.setFilter(id, id === 'social-pin-dot' ? ['all', brandFilter, ['!=', ['get', 'secondary'], '']] : brandFilter);
    }
    map.setPaintProperty('social-pins', 'circle-opacity', ['case', lit, 1, 0]);
    map.setPaintProperty('social-pins', 'circle-stroke-opacity', ['case', lit, 1, 0]);
    map.setPaintProperty('social-pin-dot', 'circle-opacity', ['case', lit, 1, 0]);
    map.setPaintProperty('social-glow', 'circle-opacity', ['case', lit, 0.5, 0]);
    return;
  }
  map.setFilter('social-pins', null);
  map.setFilter('social-glow', null);
  map.setFilter('social-pin-dot', ['!=', ['get', 'secondary'], '']);
  const isActive: mapboxgl.ExpressionSpecification = ['==', ['get', 'partner'], active ?? ''];
  const base = active ? (['case', isActive, 1, 0.25] as mapboxgl.ExpressionSpecification) : 1;
  map.setPaintProperty('social-pins', 'circle-opacity', zoomIn(base));
  map.setPaintProperty('social-pins', 'circle-stroke-opacity', zoomIn(base));
  map.setPaintProperty('social-pin-dot', 'circle-opacity', zoomIn(base));
  map.setPaintProperty('social-glow', 'circle-opacity', zoomIn(active ? ['case', isActive, 0.45, 0] : 0));
}

/** Overlapping pins fanned on a ring around the tap, each a 44pt mini
 *  medallion showing its date. */
function PinFan({ fan, onPick }: { fan: { x: number; y: number; items: FanItem[] }; onPick: (id: string) => void }) {
  const reduced = prefersReducedMotion();
  const [open, setOpen] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const raf = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(raf);
  }, [reduced]);
  const n = fan.items.length;
  return (
    <div style={{ position: 'absolute', left: fan.x, top: fan.y, width: 0, height: 0, zIndex: 3 }}>
      {fan.items.map((it, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const dx = open ? Math.cos(a) * FAN_RADIUS : 0;
        const dy = open ? Math.sin(a) * FAN_RADIUS : 0;
        return (
          <button
            key={it.id}
            className="social-press"
            aria-label={`Event on the ${it.day}`}
            onClick={() => { hapticLight(); onPick(it.id); }}
            style={{
              position: 'absolute', left: -FAN_SIZE / 2, top: -FAN_SIZE / 2, width: FAN_SIZE, height: FAN_SIZE,
              borderRadius: '50%', padding: 0, cursor: 'pointer',
              background: '#0B0A09', border: `2.5px solid ${it.color}`, boxShadow: `0 0 10px -2px ${it.color}`,
              transform: `translate(${dx}px, ${dy}px)`,
              transition: reduced ? 'none' : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
              display: 'grid', placeItems: 'center',
              fontFamily: FONT, fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums',
            }}
          >
            {it.day}
          </button>
        );
      })}
    </div>
  );
}
