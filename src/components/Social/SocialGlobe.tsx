import { useCallback, useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { MAPBOX_STYLE, type CityKey } from '../../lib/constants';
import { mapboxToken, mapboxReady } from '../../lib/supabase';
import { hapticLight } from '../../lib/haptics';
import { SOCIAL_CITY_LABEL, type SocialTheme } from '../../lib/socialTheme';
import { SOCIAL_CITIES, SOCIAL_CITY_GEO, prefersReducedMotion } from '../../lib/socialGeo';
import { Odometer } from './Odometer';

const FONT = 'Satoshi, sans-serif';

// A still globe framed on the Southeast US: all three markets on screen.
const WORLD_VIEW = { center: [-84.2, 30.4] as [number, number], zoom: 1.8, pitch: 0, bearing: 0 };

// Tampa and Pinellas sit ~20 mi apart — one pixel at globe zoom — so
// each label hangs off its dot on a different side.
const LABEL_SIDE: Record<CityKey, 'top' | 'right' | 'left'> = {
  knoxville: 'top',
  tampa: 'right',
  st_petersburg: 'left',
};

// Arrival choreography (ms): globe fades up, then buttons light in turn.
const FADE_MS = 300;
const FIRST_LIGHT_MS = 250;
const STAGGER_MS = 120;

interface SocialGlobeProps {
  theme: SocialTheme;
  counts: Record<CityKey, number>;
  /** Tab visible AND world screen showing — drives resize + reset. */
  visible: boolean;
  /** Bumped each time Social opens → replay the arrival. */
  arrivalKey: number;
  onCityChosen: (city: CityKey) => void;
}

export function SocialGlobe({ theme, counts, visible, arrivalKey, onCityChosen }: SocialGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [points, setPoints] = useState<Partial<Record<CityKey, { x: number; y: number }>>>({});
  const [flying, setFlying] = useState<CityKey | null>(null);
  const reduced = prefersReducedMotion();
  // Arrival state: globe faded up + how many city buttons are lit.
  const [globeUp, setGlobeUp] = useState(reduced);
  const [litCount, setLitCount] = useState(reduced ? SOCIAL_CITIES.length : 0);
  const onCityChosenRef = useRef(onCityChosen);
  onCityChosenRef.current = onCityChosen;

  const project = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const next: Partial<Record<CityKey, { x: number; y: number }>> = {};
    for (const city of SOCIAL_CITIES) {
      const p = map.project(SOCIAL_CITY_GEO[city].center);
      next[city] = { x: p.x, y: p.y };
    }
    setPoints(next);
  }, []);

  // ── Init once ──
  useEffect(() => {
    if (!containerRef.current || !mapboxReady) return;
    mapboxgl.accessToken = mapboxToken;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAPBOX_STYLE,
      projection: { name: 'globe' },
      ...WORLD_VIEW,
      interactive: false,          // still globe: no drag, zoom or rotation
      attributionControl: false,
      antialias: false,
    });
    mapRef.current = map;

    map.on('style.load', () => {
      map.setFog({
        color: theme.globe.fog,
        'high-color': theme.globe.highColor,
        'space-color': theme.globe.space,
        'horizon-blend': 0.04,
        'star-intensity': 0,
      });
      // Labels off — the city buttons are the only text on the globe.
      for (const layer of map.getStyle()?.layers ?? []) {
        if (layer.type === 'symbol') map.setLayoutProperty(layer.id, 'visibility', 'none');
      }
    });
    map.on('load', () => { project(); setLoaded(true); });
    map.on('resize', project);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // theme is static for the app's lifetime (build-time flag)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  // ── Becoming visible (tab switch or back from a city): reset + resize ──
  useEffect(() => {
    if (!visible) return;
    const map = mapRef.current;
    if (!map) return;
    const raf = requestAnimationFrame(() => {
      map.resize();
      map.jumpTo(WORLD_VIEW);
      setFlying(null);
      project();
    });
    return () => cancelAnimationFrame(raf);
  }, [visible, project]);

  // ── Arrival: fade up from black, light buttons one at a time ──
  useEffect(() => {
    if (reduced) return;
    setGlobeUp(false);
    setLitCount(0);
    if (!loaded) return;
    const timers: number[] = [];
    const raf = requestAnimationFrame(() => setGlobeUp(true));
    SOCIAL_CITIES.forEach((_, i) => {
      timers.push(window.setTimeout(() => setLitCount(i + 1), FIRST_LIGHT_MS + i * STAGGER_MS));
    });
    return () => { cancelAnimationFrame(raf); timers.forEach(t => window.clearTimeout(t)); };
  }, [arrivalKey, loaded, reduced]);

  const choose = useCallback((city: CityKey) => {
    const map = mapRef.current;
    if (!map || flying) return;
    hapticLight();
    if (prefersReducedMotion()) {
      onCityChosenRef.current(city);
      return;
    }
    setFlying(city);
    const geo = SOCIAL_CITY_GEO[city];
    map.once('moveend', () => onCityChosenRef.current(city));
    map.flyTo({ center: geo.center, zoom: 9.5, duration: 1800, curve: 1.4, essential: true });
  }, [flying]);

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
        const p = points[city];
        if (!p) return null;
        return (
          <CityButton
            key={city}
            city={city}
            x={p.x}
            y={p.y}
            count={counts[city] ?? 0}
            side={LABEL_SIDE[city]}
            lit={litCount > i}
            reduced={reduced}
            hidden={flying !== null}
            onTap={() => choose(city)}
          />
        );
      })}
    </div>
  );
}

interface CityButtonProps {
  city: CityKey;
  x: number;
  y: number;
  count: number;
  side: 'top' | 'right' | 'left';
  lit: boolean;
  reduced: boolean;
  hidden: boolean;
  onTap: () => void;
}

function CityButton({ city, x, y, count, side, lit, reduced, hidden, onTap }: CityButtonProps) {
  const accent = `var(--social-accent-${city})`;
  const GAP = 16;
  const labelPos: React.CSSProperties =
    side === 'top'   ? { left: '50%', bottom: GAP, transform: 'translateX(-50%)' } :
    side === 'right' ? { left: GAP, top: '50%', transform: 'translateY(-50%)' } :
                       { right: GAP, top: '50%', transform: 'translateY(-50%)' };
  const visible = lit && !hidden;
  const fade = reduced ? 'none' : 'opacity 200ms ease-out, box-shadow 200ms ease-out';

  return (
    <div style={{ position: 'absolute', left: x, top: y, width: 0, height: 0, pointerEvents: visible ? 'auto' : 'none' }}>
      <span
        aria-hidden
        style={{
          position: 'absolute', left: -4, top: -4, width: 8, height: 8, borderRadius: 4,
          background: accent,
          boxShadow: visible ? `0 0 12px ${accent}` : 'none',
          opacity: visible ? 1 : 0,
          transition: fade,
        }}
      />
      {/* Wrapper carries the positioning transform so the button's own
          :active scale doesn't fight it. */}
      <div style={{ position: 'absolute', ...labelPos }}>
        <button
          className="social-press"
          onClick={onTap}
          aria-label={`${SOCIAL_CITY_LABEL[city]}, ${count} this week`}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: side === 'left' ? 'flex-end' : 'flex-start',
            gap: 4, padding: '8px 16px', minWidth: 96,
            background: 'var(--social-surface)', border: `1px solid ${accent}`, borderRadius: 12,
            boxShadow: visible ? `0 0 16px -6px ${accent}` : 'none',
            opacity: visible ? 1 : 0,
            transition: fade,
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 800, color: accent }}>
            {SOCIAL_CITY_LABEL[city]}
          </span>
          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.04em' }}>
            <Odometer value={count} run={lit} reduced={reduced} /> this week
          </span>
        </button>
      </div>
    </div>
  );
}
