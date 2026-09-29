import { useEffect, useRef, useState } from 'react';
import { hapticLight } from '../../lib/haptics';
import mapboxgl from 'mapbox-gl';
import { MAPBOX_STYLE, type CityKey } from '../../lib/constants';
import { mapboxToken, mapboxReady } from '../../lib/supabase';
import { SOCIAL_CITY_GEO, prefersReducedMotion } from '../../lib/socialGeo';
import { brandPartnerFor, eventColor, partnerMatches, type SocialPartner, type SocialTheme } from '../../lib/socialTheme';
import type { SocialEvent } from '../../lib/socialTypes';

const SOURCE = 'social-events';
const PULSE_SOURCE = 'social-pulse';
const PIN_RADIUS = 7;
const LINK_MS = 1500;       // card + pin glow together this long
const PULSE_CYCLES = 2;     // the only loop in Social: a just-tapped pin
const PULSE_MS = 700;

/** A card↔pin link. 'card' → map flies + pulses; 'pin' → list scrolls;
 *  'post' (host demo) → both. The card and pin glow together either way. */
export interface SocialLink { id: string; nonce: number; source: 'card' | 'pin' | 'post' }

interface SocialCityMapProps {
  city: CityKey;
  theme: SocialTheme;
  partners: SocialPartner[];
  events: SocialEvent[];
  activePartner: string | null;
  /** Linked highlight — the pin glows with its card; card taps also fly + pulse. */
  link: SocialLink | null;
  /** Tab visible — resize when the container comes back. */
  visible: boolean;
  onPinTap: (eventId: string) => void;
  /** Host demo: while picking, any map tap drops the draft pin. */
  pickMode?: boolean;
  draftPin?: [number, number] | null;
  onPick?: (lngLat: [number, number]) => void;
}

const DRAFT_SOURCE = 'social-draft';

function toGeoJSON(events: SocialEvent[], theme: SocialTheme, partners: SocialPartner[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: events.map(ev => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [ev.longitude, ev.latitude] },
      properties: {
        id: ev.id,
        start: new Date(ev.start_time).getTime(),
        color: eventColor(theme, ev),
        // Branded pins carry the brand's secondary as a center dot.
        secondary: brandPartnerFor(theme, ev)?.secondary ?? '',
        day: new Date(ev.start_time).getDate(),
        partner: partners.find(p => partnerMatches(p, ev))?.key ?? '',
      },
    })),
  };
}

export function SocialCityMap({
  city, theme, partners, events, activePartner, link, visible, onPinTap,
  pickMode = false, draftPin = null, onPick,
}: SocialCityMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const loadedRef = useRef(false);
  const onPinTapRef = useRef(onPinTap);
  onPinTapRef.current = onPinTap;
  const pickRef = useRef(pickMode);
  pickRef.current = pickMode;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const latest = useRef({ events, theme, partners, activePartner });
  latest.current = { events, theme, partners, activePartner };
  const pulseFrame = useRef(0);
  // Overlapping pins fanned out around the tap point (container px).
  const [fan, setFan] = useState<{ x: number; y: number; items: FanItem[] } | null>(null);

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
    // Frame the city's actual pins, not the whole region.
    const evs0 = latest.current.events;
    if (evs0.length > 1) {
      const lngs = evs0.map(e => e.longitude);
      const lats = evs0.map(e => e.latitude);
      map.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: 40, maxZoom: 14, duration: 0 },
      );
    } else if (evs0.length === 1) {
      map.jumpTo({ center: [evs0[0].longitude, evs0[0].latitude], zoom: 14 });
    } else if (geo.bounds) {
      map.fitBounds(geo.bounds, { padding: 16, duration: 0 });
    }
    map.on('movestart', () => setFan(null));

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
      // Linked glow: the pin whose card is highlighted (filter set per link).
      map.addLayer({
        id: 'social-link',
        type: 'circle',
        source: SOURCE,
        filter: ['==', ['get', 'id'], ''],
        paint: {
          'circle-radius': 20,
          'circle-color': ['get', 'color'],
          'circle-blur': 0.6,
          'circle-opacity': 0.7,
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
      // Medallion-style pins: a ring in the signal color around a dark
      // center; branded events add a center dot in the brand's secondary.
      map.addLayer({
        id: 'social-pins',
        type: 'circle',
        source: SOURCE,
        paint: {
          'circle-radius': PIN_RADIUS,
          'circle-color': '#0B0A09',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': ['get', 'color'],
          'circle-opacity': 1,
          'circle-stroke-opacity': 1,
          'circle-opacity-transition': fade,
          'circle-stroke-opacity-transition': fade,
        },
      });
      map.addLayer({
        id: 'social-pin-dot',
        type: 'circle',
        source: SOURCE,
        filter: ['!=', ['get', 'secondary'], ''],
        paint: {
          'circle-radius': 2.5,
          'circle-color': ['get', 'secondary'],
          'circle-opacity': 1,
          'circle-opacity-transition': fade,
        },
      });

      // Host demo draft pin (white — it isn't an event yet).
      map.addSource(DRAFT_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'social-draft-ring', type: 'circle', source: DRAFT_SOURCE,
        paint: { 'circle-radius': 10, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 2, 'circle-stroke-color': '#FFFFFF' },
      });
      map.addLayer({
        id: 'social-draft-dot', type: 'circle', source: DRAFT_SOURCE,
        paint: { 'circle-radius': 3, 'circle-color': '#FFFFFF' },
      });

      map.on('click', 'social-pins', (e) => {
        if (pickRef.current) return;   // picking: the general handler drops the pin
        // Everything under the finger (±14px). One event → link it; several
        // overlapping (e.g. a weekly series at one spot) → fan them out.
        const { x, y } = e.point;
        const hits = map.queryRenderedFeatures([[x - 14, y - 14], [x + 14, y + 14]], { layers: ['social-pins'] });
        const seen = new Set<string>();
        const items: FanItem[] = [];
        for (const f of hits.sort((a, b) => Number(a.properties?.start) - Number(b.properties?.start))) {
          const id = f.properties?.id;
          if (typeof id !== 'string' || seen.has(id)) continue;
          seen.add(id);
          items.push({ id, color: String(f.properties?.color), secondary: String(f.properties?.secondary ?? ''), day: Number(f.properties?.day) });
        }
        hapticLight();
        if (items.length === 1) { setFan(null); onPinTapRef.current(items[0].id); return; }
        if (items.length > 1) setFan({ x, y, items: items.slice(0, FAN_MAX) });
      });
      map.on('click', (e) => {
        if (pickRef.current) {
          hapticLight();
          onPickRef.current?.([e.lngLat.lng, e.lngLat.lat]);
          return;
        }
        const onPin = map.queryRenderedFeatures(e.point, { layers: ['social-pins'] }).length > 0;
        if (!onPin) setFan(null);
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

  // ── Host demo: draft pin + crosshair while picking ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource(DRAFT_SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: draftPin ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: draftPin }, properties: {} }] : [],
    });
  }, [draftPin]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = pickMode ? 'crosshair' : '';
    if (pickMode) setFan(null);
  }, [pickMode]);

  // ── Resize when the tab comes back ──
  useEffect(() => {
    if (!visible) return;
    const raf = requestAnimationFrame(() => mapRef.current?.resize());
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  // ── Linked highlight: pin glows with its card; card taps fly + pulse ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !link || !loadedRef.current) return;
    const ev = latest.current.events.find(e => e.id === link.id);
    if (!ev) return;
    const reduced = prefersReducedMotion();
    const timers: number[] = [];

    map.setFilter('social-link', ['==', ['get', 'id'], ev.id]);
    timers.push(window.setTimeout(() => {
      if (map.getLayer('social-link')) map.setFilter('social-link', ['==', ['get', 'id'], '']);
    }, LINK_MS));

    cancelAnimationFrame(pulseFrame.current);
    if (link.source !== 'pin') {
      const center: [number, number] = [ev.longitude, ev.latitude];
      const zoom = Math.max(map.getZoom(), 13.5);
      if (reduced) map.jumpTo({ center, zoom });
      else map.flyTo({ center, zoom, duration: 600, essential: true });

      (map.getSource(PULSE_SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: center },
          properties: { color: eventColor(latest.current.theme, ev) },
        }],
      });

      if (reduced) {
        // No animation: a static ring confirms the target.
        map.setPaintProperty('social-pulse', 'circle-radius', PIN_RADIUS + 6);
        map.setPaintProperty('social-pulse', 'circle-stroke-opacity', 0.9);
        timers.push(window.setTimeout(() => {
          if (map.getLayer('social-pulse')) map.setPaintProperty('social-pulse', 'circle-stroke-opacity', 0);
        }, LINK_MS));
      } else {
        const t0 = performance.now() + 450;   // let the fly-to mostly settle
        const tick = (t: number) => {
          if (!map.getLayer('social-pulse')) return;
          const elapsed = t - t0;
          if (elapsed < 0) { pulseFrame.current = requestAnimationFrame(tick); return; }
          if (elapsed >= PULSE_CYCLES * PULSE_MS) {
            map.setPaintProperty('social-pulse', 'circle-stroke-opacity', 0);
            return;
          }
          const p = (elapsed % PULSE_MS) / PULSE_MS;
          map.setPaintProperty('social-pulse', 'circle-radius', PIN_RADIUS + p * 14);
          map.setPaintProperty('social-pulse', 'circle-stroke-opacity', 0.9 * (1 - p));
          pulseFrame.current = requestAnimationFrame(tick);
        };
        pulseFrame.current = requestAnimationFrame(tick);
      }
    }
    return () => {
      timers.forEach(t => window.clearTimeout(t));
      cancelAnimationFrame(pulseFrame.current);
    };
  }, [link]);

  return (
    <div
      style={{
        position: 'relative',
        height: '45vh',
        minHeight: 220,
        margin: '16px 16px 0',
        borderRadius: 16,
        border: '1px solid var(--social-accent)',
        overflow: 'hidden',
        background: 'var(--social-surface)',
        flexShrink: 0,
      }}
    >
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {fan && <PinFan fan={fan} onPick={id => { setFan(null); onPinTap(id); }} />}
    </div>
  );
}

interface FanItem { id: string; color: string; secondary: string; day: number }
const FAN_MAX = 6;
const FAN_RADIUS = 48;
const FAN_SIZE = 32;

function applyPartner(map: mapboxgl.Map, active: string | null) {
  const isActive: mapboxgl.ExpressionSpecification = ['==', ['get', 'partner'], active ?? ''];
  map.setPaintProperty('social-pins', 'circle-opacity', active ? ['case', isActive, 1, 0.25] : 1);
  map.setPaintProperty('social-pins', 'circle-stroke-opacity', active ? ['case', isActive, 1, 0.25] : 1);
  map.setPaintProperty('social-pin-dot', 'circle-opacity', active ? ['case', isActive, 1, 0.25] : 1);
  map.setPaintProperty('social-glow', 'circle-opacity', active ? ['case', isActive, 0.45, 0] : 0);
}

/** Overlapping pins fanned out on a small ring around the tap point, each
 *  a mini medallion showing its date. */
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
    <div style={{ position: 'absolute', left: fan.x, top: fan.y, width: 0, height: 0, zIndex: 2 }}>
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
              background: '#0B0A09', border: `2.5px solid ${it.color}`,
              boxShadow: `0 0 10px -2px ${it.color}`,
              transform: `translate(${dx}px, ${dy}px)`,
              transition: reduced ? 'none' : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
              display: 'grid', placeItems: 'center',
              fontFamily: 'Satoshi, sans-serif', fontSize: 13, fontWeight: 800, color: 'var(--text-primary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {it.day}
          </button>
        );
      })}
    </div>
  );
}
