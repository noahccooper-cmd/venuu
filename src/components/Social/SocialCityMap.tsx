import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { MAPBOX_STYLE, type CityKey } from '../../lib/constants';
import { mapboxToken, mapboxReady } from '../../lib/supabase';
import { SOCIAL_CITY_GEO, prefersReducedMotion } from '../../lib/socialGeo';
import { partnerMatches, type SocialPartner, type SocialTheme } from '../../lib/socialTheme';
import type { SocialEvent } from '../../lib/socialTypes';

const SOURCE = 'social-events';
const PULSE_SOURCE = 'social-pulse';
const PIN_RADIUS = 7;

export interface MapFocus { id: string; nonce: number }

interface SocialCityMapProps {
  city: CityKey;
  theme: SocialTheme;
  partners: SocialPartner[];
  events: SocialEvent[];
  activePartner: string | null;
  /** Card tap → fly to this event's pin and pulse it. */
  focus: MapFocus | null;
  /** Tab visible — resize when the container comes back. */
  visible: boolean;
  onPinTap: (eventId: string) => void;
}

function toGeoJSON(events: SocialEvent[], theme: SocialTheme, partners: SocialPartner[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: events.map(ev => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [ev.longitude, ev.latitude] },
      properties: {
        id: ev.id,
        start: new Date(ev.start_time).getTime(),
        color: theme.categoryColors[ev.category],
        partner: partners.find(p => partnerMatches(p, ev))?.key ?? '',
      },
    })),
  };
}

export function SocialCityMap({ city, theme, partners, events, activePartner, focus, visible, onPinTap }: SocialCityMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const loadedRef = useRef(false);
  const onPinTapRef = useRef(onPinTap);
  onPinTapRef.current = onPinTap;
  const latest = useRef({ events, theme, partners, activePartner });
  latest.current = { events, theme, partners, activePartner };
  const pulseFrame = useRef(0);

  // ── Init (one instance per city visit) ──
  useEffect(() => {
    if (!containerRef.current || !mapboxReady) return;
    mapboxgl.accessToken = mapboxToken;
    const geo = SOCIAL_CITY_GEO[city];
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAPBOX_STYLE,
      center: geo.center,
      zoom: geo.zoom,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
      antialias: false,
    });
    mapRef.current = map;
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    if (geo.bounds) map.fitBounds(geo.bounds, { padding: 16, duration: 0 });

    map.on('style.load', () => {
      for (const layer of map.getStyle()?.layers ?? []) {
        if (layer.type === 'symbol' && layer.id.includes('poi')) {
          map.setLayoutProperty(layer.id, 'visibility', 'none');
        }
      }
    });

    map.on('load', () => {
      const { events: evs, theme: th, partners: ps } = latest.current;
      map.addSource(SOURCE, { type: 'geojson', data: toGeoJSON(evs, th, ps) });
      map.addSource(PULSE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      const fade = prefersReducedMotion() ? { duration: 0, delay: 0 } : { duration: 250, delay: 0 };

      map.addLayer({
        id: 'social-glow',
        type: 'circle',
        source: SOURCE,
        paint: {
          'circle-radius': 16,
          'circle-color': ['get', 'color'],
          'circle-blur': 0.7,
          'circle-opacity': 0,
          'circle-opacity-transition': fade,
        },
      });
      map.addLayer({
        id: 'social-pulse',
        type: 'circle',
        source: PULSE_SOURCE,
        paint: {
          'circle-radius': PIN_RADIUS,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 2,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-opacity': 0,
        },
      });
      map.addLayer({
        id: 'social-pins',
        type: 'circle',
        source: SOURCE,
        paint: {
          'circle-radius': PIN_RADIUS,
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#050507',
          'circle-opacity': 1,
          'circle-stroke-opacity': 1,
          'circle-opacity-transition': fade,
          'circle-stroke-opacity-transition': fade,
        },
      });

      map.on('click', 'social-pins', (e) => {
        // Topmost pin wins; a weekly series stacks at that exact spot, so
        // among pins sharing its coordinates the tap means the next one.
        const feats = e.features ?? [];
        const top = feats[0];
        if (!top || top.geometry.type !== 'Point') return;
        const [tx, ty] = top.geometry.coordinates;
        const soonest = feats
          .filter(f => f.geometry.type === 'Point'
            && f.geometry.coordinates[0] === tx && f.geometry.coordinates[1] === ty)
          .sort((a, b) => Number(a.properties?.start) - Number(b.properties?.start))[0];
        const id = soonest?.properties?.id;
        if (typeof id === 'string') onPinTapRef.current(id);
      });
      map.on('mouseenter', 'social-pins', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'social-pins', () => { map.getCanvas().style.cursor = ''; });

      loadedRef.current = true;
      applyPartner(map, latest.current.activePartner);
    });

    return () => {
      cancelAnimationFrame(pulseFrame.current);
      loadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, [city]);

  // ── Data ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource(SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData(toGeoJSON(events, theme, partners));
  }, [events, theme, partners]);

  // ── Active partner: glow its pins, dim the rest to 0.25 ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    applyPartner(map, activePartner);
  }, [activePartner]);

  // ── Resize when the tab comes back ──
  useEffect(() => {
    if (!visible) return;
    const raf = requestAnimationFrame(() => mapRef.current?.resize());
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  // ── Card tap → fly to pin + brief pulse ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    const ev = latest.current.events.find(e => e.id === focus.id);
    if (!ev) return;
    const reduced = prefersReducedMotion();
    const center: [number, number] = [ev.longitude, ev.latitude];
    const zoom = Math.max(map.getZoom(), 13.5);
    if (reduced) map.jumpTo({ center, zoom });
    else map.flyTo({ center, zoom, duration: 600, essential: true });

    const src = map.getSource(PULSE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: center },
        properties: { color: latest.current.theme.categoryColors[ev.category] },
      }],
    });

    cancelAnimationFrame(pulseFrame.current);
    if (reduced) {
      // No animation: a static ring for a moment confirms the target.
      map.setPaintProperty('social-pulse', 'circle-radius', PIN_RADIUS + 6);
      map.setPaintProperty('social-pulse', 'circle-stroke-opacity', 0.9);
      const t = window.setTimeout(() => map.getLayer('social-pulse') && map.setPaintProperty('social-pulse', 'circle-stroke-opacity', 0), 900);
      return () => window.clearTimeout(t);
    }
    const DELAY = 450;   // let the fly-to mostly settle first
    const DURATION = 900;
    const t0 = performance.now() + DELAY;
    const tick = (t: number) => {
      if (!map.getLayer('social-pulse')) return;
      const p = (t - t0) / DURATION;
      if (p < 0) { pulseFrame.current = requestAnimationFrame(tick); return; }
      if (p >= 1) { map.setPaintProperty('social-pulse', 'circle-stroke-opacity', 0); return; }
      map.setPaintProperty('social-pulse', 'circle-radius', PIN_RADIUS + p * 16);
      map.setPaintProperty('social-pulse', 'circle-stroke-opacity', 0.9 * (1 - p));
      pulseFrame.current = requestAnimationFrame(tick);
    };
    pulseFrame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(pulseFrame.current);
  }, [focus]);

  return (
    <div
      style={{
        position: 'relative',
        height: '45vh',
        minHeight: 220,
        margin: '12px 16px 0',
        borderRadius: 16,
        border: '1px solid var(--social-accent)',
        overflow: 'hidden',
        background: 'var(--bg-card)',
        flexShrink: 0,
      }}
    >
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  );
}

function applyPartner(map: mapboxgl.Map, active: string | null) {
  const isActive: mapboxgl.ExpressionSpecification = ['==', ['get', 'partner'], active ?? ''];
  map.setPaintProperty('social-pins', 'circle-opacity', active ? ['case', isActive, 1, 0.25] : 1);
  map.setPaintProperty('social-pins', 'circle-stroke-opacity', active ? ['case', isActive, 1, 0.25] : 1);
  map.setPaintProperty('social-glow', 'circle-opacity', active ? ['case', isActive, 0.45, 0] : 0);
}
