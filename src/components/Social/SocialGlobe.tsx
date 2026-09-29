import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import mapboxgl from 'mapbox-gl';
import { MAPBOX_STYLE, type CityKey } from '../../lib/constants';
import { mapboxToken, mapboxReady } from '../../lib/supabase';
import type { SocialPartner, SocialTheme } from '../../lib/socialTheme';
import { SOCIAL_CITIES, SOCIAL_CITY_GEO, prefersReducedMotion } from '../../lib/socialGeo';
import { CityPin, PartnerPin } from './GlobePins';

const FONT = 'Satoshi, sans-serif';

// Framed on the Southeast US: all three markets on screen at rest.
const WORLD_VIEW = { center: [-84.2, 30.4] as [number, number], zoom: 1.8, pitch: 0, bearing: 0 };
const MIN_ZOOM = 1.5;
const MAX_ZOOM = 2.4;

// Idle drift: ~1°/s westward spin; pauses on any touch, resumes after 4s.
const DRIFT_DEG_PER_S = 1;
const RESUME_AFTER_MS = 4000;

// Arrival choreography (ms): globe fades up, then pins light in turn.
const FADE_MS = 300;
const FIRST_LIGHT_MS = 250;
const STAGGER_MS = 120;

// Far-side fade: full opacity inside FADE_START° of the view center,
// gone by FADE_END° (the horizon is ~90°).
const FADE_START = 65;
const FADE_END = 85;

interface SocialGlobeProps {
  theme: SocialTheme;
  counts: Record<CityKey, number>;
  /** Partners pinned on the globe (those with a `home`). */
  pinnedPartners: SocialPartner[];
  /** Tab visible AND world screen showing — drives resize, reset, drift. */
  visible: boolean;
  /** Bumped each time Social opens → replay the arrival. */
  arrivalKey: number;
  onCityChosen: (city: CityKey) => void;
  onPartnerTap: (key: string) => void;
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

export function SocialGlobe({ theme, counts, pinnedPartners, visible, arrivalKey, onCityChosen, onPartnerTap }: SocialGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [flying, setFlying] = useState<CityKey | null>(null);
  const reduced = prefersReducedMotion();
  // Arrival state: globe faded up + how many pins are lit.
  const [globeUp, setGlobeUp] = useState(reduced);
  const [litCount, setLitCount] = useState(reduced ? 99 : 0);
  // One DOM element per pin, owned by a Mapbox marker so it turns with the globe.
  const [pinEls, setPinEls] = useState<Partial<Record<PinKey, HTMLDivElement>>>({});
  const pinCoords = useRef(new Map<PinKey, [number, number]>());
  const lastInputAt = useRef(0);
  const dragging = useRef(false);
  const flyingRef = useRef(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const onCityChosenRef = useRef(onCityChosen);
  onCityChosenRef.current = onCityChosen;
  const pinElsRef = useRef<Partial<Record<PinKey, HTMLDivElement>>>({});
  const pinnedPartnersRef = useRef(pinnedPartners);
  pinnedPartnersRef.current = pinnedPartners;

  // ── Init once ──
  useEffect(() => {
    if (!containerRef.current || !mapboxReady) return;
    mapboxgl.accessToken = mapboxToken;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAPBOX_STYLE,
      projection: { name: 'globe' },
      ...WORLD_VIEW,
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
    map.on('mousedown', touch);
    map.on('touchstart', touch);
    map.on('wheel', touch);
    map.on('dragstart', () => { dragging.current = true; touch(); });
    map.on('dragend', () => { dragging.current = false; touch(); });

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

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // theme + pinned partners are static for the app's lifetime (build-time flag)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ── Becoming visible (tab switch or back from a city): reset + resize ──
  useEffect(() => {
    if (!visible) return;
    const map = mapRef.current;
    if (!map) return;
    const raf = requestAnimationFrame(() => {
      map.resize();
      map.jumpTo(WORLD_VIEW);
      map.setMaxZoom(MAX_ZOOM);   // restore the globe-range lock after a fly-down
      flyingRef.current = false;
      setFlying(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  // ── Idle drift (never under reduced motion) ──
  useEffect(() => {
    if (reduced || !loaded) return;
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = (now - prev) / 1000;
      prev = now;
      const map = mapRef.current;
      const idle = now - lastInputAt.current > RESUME_AFTER_MS;
      if (map && visibleRef.current && idle && !dragging.current && !flyingRef.current && !map.isMoving()) {
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

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
      <div
        ref={containerRef}
        style={{
          position: 'absolute', inset: 0,
          opacity: globeUp ? 1 : 0,
          transition: reduced ? 'none' : `opacity ${FADE_MS}ms ease-out`,
        }}
      />

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
            lit={litCount > i && flying === null}
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
            lit={litCount > SOCIAL_CITIES.length + i && flying === null}
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
