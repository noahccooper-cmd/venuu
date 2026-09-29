import { useCallback, useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { MAPBOX_STYLE, type CityKey } from '../../lib/constants';
import { mapboxToken, mapboxReady } from '../../lib/supabase';
import { SOCIAL_CITY_LABEL, type SocialTheme } from '../../lib/socialTheme';
import { SOCIAL_CITIES, SOCIAL_CITY_GEO, prefersReducedMotion } from '../../lib/socialGeo';

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

interface SocialGlobeProps {
  theme: SocialTheme;
  counts: Record<CityKey, number>;
  /** Tab visible AND world screen showing — drives resize + reset. */
  visible: boolean;
  onCityChosen: (city: CityKey) => void;
}

export function SocialGlobe({ theme, counts, visible, onCityChosen }: SocialGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [points, setPoints] = useState<Partial<Record<CityKey, { x: number; y: number }>>>({});
  const [flying, setFlying] = useState<CityKey | null>(null);
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
    map.on('load', project);
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

  const choose = useCallback((city: CityKey) => {
    const map = mapRef.current;
    if (!map || flying) return;
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
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {!mapboxReady && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: FONT, color: 'var(--text-secondary)', fontSize: 13 }}>
          Map requires VITE_MAPBOX_TOKEN
        </div>
      )}

      {SOCIAL_CITIES.map(city => {
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
  hidden: boolean;
  onTap: () => void;
}

function CityButton({ city, x, y, count, side, hidden, onTap }: CityButtonProps) {
  const accent = `var(--social-accent-${city})`;
  const GAP = 14;
  const labelPos: React.CSSProperties =
    side === 'top'   ? { left: '50%', bottom: GAP, transform: 'translateX(-50%)' } :
    side === 'right' ? { left: GAP, top: '50%', transform: 'translateY(-50%)' } :
                       { right: GAP, top: '50%', transform: 'translateY(-50%)' };

  return (
    <div
      style={{
        position: 'absolute', left: x, top: y, width: 0, height: 0,
        opacity: hidden ? 0 : 1,
        transition: 'opacity 200ms ease',
        pointerEvents: hidden ? 'none' : 'auto',
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute', left: -4, top: -4, width: 8, height: 8, borderRadius: 4,
          background: accent, boxShadow: `0 0 10px ${accent}`,
        }}
      />
      <button
        onClick={onTap}
        aria-label={`${SOCIAL_CITY_LABEL[city]}, ${count} this week`}
        style={{
          position: 'absolute', ...labelPos,
          display: 'flex', flexDirection: 'column', alignItems: side === 'left' ? 'flex-end' : 'flex-start',
          gap: 2, padding: '8px 12px', minWidth: 92,
          background: 'var(--bg-card)', border: `1px solid ${accent}`, borderRadius: 10,
          boxShadow: `0 0 18px -6px ${accent}`,
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 800, color: accent }}>
          {SOCIAL_CITY_LABEL[city]}
        </span>
        <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
          {count} this week
        </span>
      </button>
    </div>
  );
}
