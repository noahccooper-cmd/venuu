import { useEffect, useRef, useCallback, useMemo, useState, type MutableRefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import mapboxgl from 'mapbox-gl';
import { Globe, Share2 } from 'lucide-react';
import type { CityAggregate } from '../../hooks/useCityAggregates';
import type { ColdOpenPhase } from '../../hooks/useColdOpen';
import { CITIES, MAPBOX_STYLE, type CityKey } from '../../lib/constants';
import { mapboxToken, mapboxReady } from '../../lib/supabase';
import { getShortName, formatCount, getCoverLabel } from '../../lib/utils';
import { getEventTimeLabel } from '../../lib/eventUtils';
import { formatWalkDuration, formatWalkDistance } from '../../lib/directions';
import { formatCoverPriceShort } from '../../lib/coverPricing';
import type { CoverPriceInfo } from '../../hooks/useCoverPricing';
import { getNightPhase, fetchRoutesForParticles, spawnParticle, tickParticle, particlesToGeoJSON, type Particle, type RouteCache } from '../../lib/mapEffects';
import type { Venue, VenueEvent } from '../../lib/types';
import type { HeadcountEstimate } from '../../hooks/useVenuesInBounds';
import { LiveVenueBubble } from './LiveVenueBubble';
import { LiveEventsFeed } from './LiveEventsFeed';
import { HeatFieldLayer } from './HeatFieldLayer';
import VibeCanvasLayer from './VibeCanvasLayer';
import { useHeatField } from '../../hooks/useHeatField';
import { useVibeCanvasPoints } from '../../hooks/useVibeCanvasPoints';
import type { Plan as VennyPlan } from '../Venny/PlanCard';
import { FEATURE_FLAGS } from '../../lib/featureFlags';
import { CityPulseLine } from '../Market/CityPulseLine';
import { MoversChip } from '../Market/MoversDrawer';
import { MarketPanel } from '../Market/MarketPanel';
import { MarketTicker } from '../Market/MarketTicker';

/** True between 5pm and 3am local — boosts heat-field intensity. */
function isNightHours(): boolean {
  const hour = new Date().getHours();
  return hour >= 17 || hour < 3;
}

/** Great-circle distance in km between two (lat, lng) pairs. Used by
 *  the smart-density name-label heuristic ("within ~500m of user"). */
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Venue augmented with the latest fused estimate from the prediction engine. */
type VenueWithEstimate = Venue & { headcount_estimates?: HeadcountEstimate[] };

/** Has this estimate enough information to take over the bubble visual? */
function hasUsableEstimate(est: HeadcountEstimate | undefined): est is HeadcountEstimate {
  if (!est) return false;
  if (est.state_label === 'Unknown') return false;
  return est.confidence_pct >= 10;
}

/* ── Animated Count Helper ──────────── */

/** Animate a DOM element's text from one number to another over 600ms ease-out.
 *  If the jump is > 10, skip to within 3 of the target and tick the last 3. */
function animateCountTo(
  el: HTMLElement,
  from: number,
  to: number,
  fmt: (n: number) => string,
) {
  if (from === to || to === 0) {
    el.textContent = to === 0 ? '' : fmt(to);
    return;
  }

  // Determine effective start: skip to within 3 if big jump
  const diff = to - from;
  const absDiff = Math.abs(diff);
  const effectiveFrom = absDiff > 10 ? to - Math.sign(diff) * 3 : from;

  // Immediately show the skip-to value if we jumped
  if (effectiveFrom !== from) {
    el.textContent = fmt(effectiveFrom);
  }

  const duration = 600;
  const start = performance.now();
  const range = to - effectiveFrom;

  function tick(now: number) {
    const elapsed = now - start;
    const t = Math.min(elapsed / duration, 1);
    // ease-out cubic
    const eased = 1 - Math.pow(1 - t, 3);
    const current = Math.round(effectiveFrom + range * eased);
    el.textContent = fmt(current);
    if (t < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

/* ── 7-Stage Heat Map Bubble Visuals ──────────── */

interface BubbleVisuals {
  stage: number;
  color: string;
  size: number;
  glow: string;
  pulse: string;
  fontSize: string;
  showRing: boolean;
  showCount: boolean;
}

/** Font size based on headcount for readability at every bubble size */
function getCountFontSize(count: number): string {
  if (count <= 15) return '10px';
  if (count <= 35) return '11px';
  if (count <= 60) return '13px';
  if (count <= 100) return '15px';
  if (count <= 150) return '17px';
  return '19px';
}

function getVenueVisuals(headcount: number): BubbleVisuals {
  // Stage 0: empty — gray dot, no number
  if (headcount === 0) return {
    stage: 0, color: '#6B7280', size: 24, glow: 'none',
    pulse: 'none', fontSize: '0px', showRing: false, showCount: false,
  };
  const fontSize = getCountFontSize(headcount);
  if (headcount <= 10) return {
    stage: 1, color: '#3B82F6', size: 28, glow: '0 0 8px rgba(59,130,246,0.4)',
    pulse: 'none', fontSize, showRing: false, showCount: true,
  };
  if (headcount <= 30) return {
    stage: 2, color: '#8B5CF6', size: 32, glow: '0 0 12px rgba(139,92,246,0.5)',
    pulse: 'venue-pulse-slow 3s ease-in-out infinite', fontSize, showRing: false, showCount: true,
  };
  if (headcount <= 60) return {
    stage: 3, color: '#F59E0B', size: 36, glow: '0 0 16px rgba(245,158,11,0.5)',
    pulse: 'venue-pulse-slow 2.5s ease-in-out infinite', fontSize, showRing: false, showCount: true,
  };
  if (headcount <= 120) return {
    stage: 4, color: '#EF4444', size: 42, glow: '0 0 20px rgba(239,68,68,0.5)',
    pulse: 'venue-pulse-medium 2s ease-in-out infinite', fontSize, showRing: false, showCount: true,
  };
  if (headcount <= 200) return {
    stage: 5, color: '#FF6B2C', size: 48, glow: '0 0 24px rgba(255,107,44,0.6)',
    pulse: 'venue-pulse-fast 1.5s ease-in-out infinite', fontSize, showRing: false, showCount: true,
  };
  // Stage 6: 201+
  if (headcount <= 350) return {
    stage: 6, color: '#EC4899', size: 54, glow: '0 0 30px rgba(236,72,153,0.6)',
    pulse: 'venue-pulse-fast 1.2s ease-in-out infinite', fontSize, showRing: true, showCount: true,
  };
  // Stage 7: 351+ legendary
  return {
    stage: 7, color: '#EC4899', size: 58, glow: '0 0 36px rgba(236,72,153,0.7), 0 0 60px rgba(236,72,153,0.3)',
    pulse: 'venue-pulse-legendary 1s ease-in-out infinite', fontSize, showRing: true, showCount: true,
  };
}

/** Set animation on an element with -webkit- prefix for iOS Capacitor compat */
function setAnim(el: HTMLElement, value: string) {
  el.style.animation = value;
  (el.style as unknown as Record<string, string>).webkitAnimation = value;
}

/* ── Types ──────────── */

interface MarkerEntry {
  marker: mapboxgl.Marker;
  el: HTMLDivElement;
  bubbleEl: HTMLDivElement;
  glowEl: HTMLDivElement;
  particlesEl: HTMLDivElement;
  ringEl: HTMLDivElement;
  ring2El: HTMLDivElement;
  countEl: HTMLSpanElement;
  labelEl: HTMLDivElement;
  featuredBadgeEl: HTMLDivElement;
  featuredLabelEl: HTMLDivElement;
  liveEl: HTMLDivElement;
  coverEl: HTMLDivElement;
  priceTagEl: HTMLDivElement;
  /** Mount point for the React-rendered LiveVenueBubble overlay. */
  reactMount: HTMLDivElement;
  /** React root that owns the LiveVenueBubble inside reactMount. */
  reactRoot: Root;
  /** True when the prediction-engine bubble has taken over the visual. */
  hasLiveOverlay: boolean;
  currentStage: number;
  currentCount: number;
  isFeatured: boolean;
  isFraternity: boolean;
  hasEvent: boolean;
}

interface UserLocationPoint {
  lng: number;
  lat: number;
  accuracy: number;
}

interface MapViewProps {
  city: CityKey;
  venues: Venue[];
  venueFilter?: 'all' | 'bars' | 'greek';
  counts: Record<string, number>;
  liveVenueIds: Set<string>;
  pulsedVenueId: string | null;
  events?: VenueEvent[];
  coverPrices?: Map<string, CoverPriceInfo>;
  userLocation?: UserLocationPoint | null;
  route?: GeoJSON.LineString | null;
  routeDuration?: number | null;
  routeDistance?: number | null;
  routeDestination?: string | null;
  routeArrived?: boolean;
  followMode?: 'free' | 'center' | 'bearing';
  onVenueClick: (venue: Venue) => void;
  onEventClick?: (event: VenueEvent) => void;
  onMapTap?: () => void;
  onCityChange?: (city: CityKey) => void;
  /** Tap on a city dot at globe view — parent updates currentCity. */
  onCityTapFromGlobe?: (city: CityKey) => void;
  /** City rollups for the globe-view dot layer + headline counter. */
  cityAggregates?: CityAggregate[];
  /** Sum of `peopleOut` across `cityAggregates`. Shown in globe overlay. */
  totalPeopleOut?: number;
  /** True while the cold-open intro is playing — disables some UX. */
  introActive?: boolean;
  /** Current intro phase; bloom triggers only on 'bubble-bloom'. */
  introPhase?: ColdOpenPhase;
  /** Fires once the underlying mapboxgl.Map is constructed and assigned. */
  onMapReady?: (map: mapboxgl.Map) => void;
  /** Tap on the share button at globe view → share current snapshot. */
  onShareGlobe?: () => void;
  /** True while a share is mid-flight (canvas composite + share sheet). */
  sharingGlobe?: boolean;
  onCancelRoute?: () => void;
  onPriceTap?: (venueId: string, venueName: string) => void;
  onToggleFollow?: () => void;
  onUserDragMap?: () => void;
  mapInstanceRef?: MutableRefObject<mapboxgl.Map | null>;
  /** Venue IDs Venny has highlighted. When non-empty, matching bubbles
   *  get an orange ring + scale boost and non-matching bubbles fade. */
  highlightedVenueIds?: string[];
  /** When non-null, render an orange route polyline + numbered stop
   *  markers connecting the plan's stops, and fit camera to all. */
  activePlan?: VennyPlan | null;
  /** Called when the user taps a numbered route marker. */
  onPlanStopTap?: (stopIndex: number) => void;
  /** Stop index the parent currently considers "focused" (e.g. the
   *  user tapped a stop in the sheet). Receives a brief pulse class
   *  on its marker. */
  focusedStopIndex?: number | null;
  /** Plan sheet state — drives camera ease padding so the focused
   *  stop stays visible above the sheet. */
  sheetState?: 'pill' | 'card' | 'full' | null;
  /** Phase C (Vibe canvas) — currently selected venue id (e.g. when the
   *  VenueSheet is open). Threaded to HeatFieldLayer to drive the
   *  tap-bleed expansion in the halos layer. Null → no bleed. */
  selectedVenueId?: string | null;
}

/* ── Events GeoJSON builder ──────────── */

const EVENT_LAYERS = ['events-label', 'events-core', 'events-ring', 'events-pulse', 'events-glow', 'events-aura', 'events-ping1', 'events-ping2', 'events-ping3'] as const;

function buildEventsGeoJSON(events: VenueEvent[], venues: Venue[]): GeoJSON.FeatureCollection {
  const venueMap = new Map(venues.map(v => [v.id, v]));
  return {
    type: 'FeatureCollection',
    features: events.map(evt => {
      let lng = evt.longitude;
      let lat = evt.latitude;
      if (evt.venue_id) {
        const v = venueMap.get(evt.venue_id);
        if (v) { lng = v.lng; lat = v.lat; }
      }
      const isFrat = evt.venue_id ? venueMap.get(evt.venue_id)?.category === 'fraternity' : false;
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [lng, lat] },
        properties: {
          id: evt.id,
          label: `\u26A1 ${evt.title}\n${getEventTimeLabel(evt.start_time, evt.expires_at).text}`,
          isFratEvent: isFrat ? 1 : 0,
        },
      };
    }),
  };
}

/**
 * drawLineProgress — given an ordered list of [lng, lat] coords and a
 * progress fraction `t` in [0,1], returns the coords subset that
 * represents the line "drawn in" to that fraction of total length.
 * The last point is interpolated between two consecutive coords so the
 * animation looks continuous rather than stepping segment-by-segment.
 */
function drawLineProgress(coords: [number, number][], t: number): [number, number][] {
  if (coords.length === 0) return [];
  if (t <= 0) return [coords[0]];
  if (t >= 1) return coords;

  // Compute segment lengths in plain euclidean lng/lat space — close
  // enough for short city-scale plans, and avoids haversine costs on
  // every RAF tick.
  let total = 0;
  const segLens: number[] = [];
  for (let i = 1; i < coords.length; i++) {
    const dx = coords[i][0] - coords[i - 1][0];
    const dy = coords[i][1] - coords[i - 1][1];
    const len = Math.hypot(dx, dy);
    segLens.push(len);
    total += len;
  }
  if (total === 0) return [coords[0]];

  const target = total * t;
  const out: [number, number][] = [coords[0]];
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    const next = acc + segLens[i];
    if (next >= target) {
      const local = (target - acc) / (segLens[i] || 1);
      const x = coords[i][0] + (coords[i + 1][0] - coords[i][0]) * local;
      const y = coords[i][1] + (coords[i + 1][1] - coords[i][1]) * local;
      out.push([x, y]);
      return out;
    }
    out.push(coords[i + 1]);
    acc = next;
  }
  return out;
}

/* ── Main MapView Component ──────────── */

export function MapView({ city, venues, venueFilter, counts, liveVenueIds, pulsedVenueId, events, coverPrices, userLocation, route, routeDuration, routeDistance, routeDestination, routeArrived, followMode, onVenueClick, onEventClick, onMapTap, onCityTapFromGlobe, cityAggregates, totalPeopleOut, introActive, introPhase, onMapReady, onShareGlobe, sharingGlobe, onCancelRoute, onPriceTap, onToggleFollow, onUserDragMap, mapInstanceRef, highlightedVenueIds, activePlan, onPlanStopTap, focusedStopIndex, sheetState, selectedVenueId }: MapViewProps) {
  // Side pills (share-globe / globe / follow-me) fade out and slide
  // down while the plan sheet covers the bottom of the map. They
  // remain visible at PILL state (sheet is at the top) and when no
  // sheet is active.
  const sheetHidesSidePills = sheetState === 'card' || sheetState === 'full';
  const sidePillSheetStyle: React.CSSProperties = {
    opacity: sheetHidesSidePills ? 0 : 1,
    pointerEvents: sheetHidesSidePills ? 'none' : 'auto',
    transform: sheetHidesSidePills ? 'translateY(20px)' : 'translateY(0)',
    transition: 'opacity 320ms cubic-bezier(0.2, 0.7, 0.2, 1), transform 320ms cubic-bezier(0.2, 0.7, 0.2, 1), border-color 0.2s, bottom 0.3s',
  };

  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, MarkerEntry>>(new Map());
  const markersVisibleRef = useRef(true);
  const tMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const animFrameRef = useRef<number>(0);
  const routeCoordsRef = useRef<[number, number][] | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const routeCacheRef = useRef<RouteCache | null>(null);
  const nightPhaseRef = useRef(getNightPhase());
  const entrancePlayedRef = useRef(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  // Market-mode zoom bucket. Only the bucket transitions trigger a
  // React re-render of the LiveVenueBubble overlay — keeps zoom
  // interactions cheap. Snapped to a representative zoom number so
  // the bubble can do its own < 13 / < 15 / >= 15 tier math.
  const [marketZoom, setMarketZoom] = useState<number>(16);
  const marketZoomBucketRef = useRef<'wide' | 'mid' | 'tight'>('tight');
  // Market View Mode — the signature gesture. Chip morphs upward
  // into MarketPanel via shared layoutId; map bubbles BOLD-transform
  // with staggered choreography while active.
  const [marketViewActive, setMarketViewActive] = useState(false);
  // Currently-spotlighted venue from the panel; the matching bubble
  // overrides scale + adds a pulsing glow. Cleared on exit.
  const [spotlightVenueId, setSpotlightVenueId] = useState<string | null>(null);
  const exitMarketView = useCallback(() => {
    setMarketViewActive(false);
    setSpotlightVenueId(null);
  }, []);
  // Biggest absolute delta in this batch defines the BOLD entry
  // stagger curve. Each bubble's `movementMagnitude` = |its delta| /
  // maxAbsDelta, so the strongest mover gets delay 0, weakest gets
  // ~600ms. Recomputed when the venue list changes.
  const maxAbsDelta = useMemo(() => {
    let max = 0;
    for (const v of venues as VenueWithEstimate[]) {
      const d = v.headcount_estimates?.[0]?.delta_pct;
      if (typeof d === 'number') {
        const abs = Math.abs(d);
        if (abs > max) max = abs;
      }
    }
    return max > 0 ? max : 1;
  }, [venues]);
  // Top-5 venues by |delta_pct| — these always show their name label
  // regardless of zoom. Membership is computed once per venue batch and
  // memoized so the per-marker render loop is a cheap Set.has() lookup.
  const topMoverIds = useMemo(() => {
    const ranked = (venues as VenueWithEstimate[])
      .map(v => ({ id: v.id, abs: Math.abs(v.headcount_estimates?.[0]?.delta_pct ?? 0) }))
      .filter(x => x.abs > 0)
      .sort((a, b) => b.abs - a.abs)
      .slice(0, 5);
    return new Set(ranked.map(x => x.id));
  }, [venues]);
  const initialCityRef = useRef(city);
  const venuesRef = useRef(venues);
  const countsRef = useRef(counts);
  // ── Venny plan route refs ──
  // Mapbox source+layer pair for the route polyline + glow, plus DOM
  // markers anchored at each stop. animFrame and `lastSignature` let
  // us avoid re-animating the draw-in when only the camera moves.
  const planMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const planAnimRafRef = useRef<number | null>(null);
  const planSignatureRef = useRef<string | null>(null);
  const onPlanStopTapRef = useRef(onPlanStopTap);
  onPlanStopTapRef.current = onPlanStopTap;
  const eventsRef = useRef(events);
  const onVenueClickRef = useRef(onVenueClick);
  const onEventClickRef = useRef(onEventClick);
  const onPriceTapRef = useRef(onPriceTap);
  venuesRef.current = venues;
  countsRef.current = counts;
  eventsRef.current = events;
  onVenueClickRef.current = onVenueClick;
  onPriceTapRef.current = onPriceTap;

  // Heat field — the atmospheric layer beneath the bubbles.
  const { geojson: heatGeojson } = useHeatField(city);
  const { points: canvasPoints } = useVibeCanvasPoints(city);

  // ── Globe view state (zoom < 4 → "we're at the globe") ───────
  const [isAtGlobe, setIsAtGlobe] = useState(false);
  const onCityTapFromGlobeRef = useRef(onCityTapFromGlobe);
  onCityTapFromGlobeRef.current = onCityTapFromGlobe;
  const cityPulseFrameRef = useRef<number>(0);

  useEffect(() => {
    if (!mapContainer.current || !mapboxReady) return;

    mapboxgl.accessToken = mapboxToken;

    const config = CITIES[initialCityRef.current];
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAPBOX_STYLE,
      center: [config.center.lng, config.center.lat],
      zoom: config.zoom,
      bearing: 0,
      pitch: 30,
      minZoom: 1,
      maxZoom: 18,
      // Globe at low zoom (< ~5) auto-transitions to Mercator as you zoom in.
      projection: { name: 'globe' },
      attributionControl: false,
      failIfMajorPerformanceCaveat: false,
      preserveDrawingBuffer: false,
      antialias: false,
    });

    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();

    map.on('error', () => {});
    map.getCanvas().addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
    });
    map.getCanvas().addEventListener('webglcontextrestored', () => {
      map.resize();
      map.triggerRepaint();
    });

    /* ── Zoom-aware: remove/add markers to free GPU entirely ── */
    let markersVisible = true;
    let tVisible = true;

    map.on('zoom', () => {
      const zoom = map.getZoom();

      // Venue markers: remove from map when zoom < 12, re-add when >= 12
      if (zoom < 12 && markersVisible) {
        markersRef.current.forEach(entry => entry.marker.remove());
        markersVisible = false;
        markersVisibleRef.current = false;
      }
      if (zoom >= 12 && !markersVisible) {
        markersRef.current.forEach(entry => entry.marker.addTo(map));
        markersVisible = true;
        markersVisibleRef.current = true;
      }

      // Power T: remove from map when zoom < 11, re-add when >= 11
      if (zoom < 11 && tVisible) {
        tMarkerRef.current?.remove();
        tVisible = false;
      }
      if (zoom >= 11 && !tVisible) {
        if (tMarkerRef.current) tMarkerRef.current.addTo(map);
        tVisible = true;
      }

      // Market-mode bucket. Snap to a representative zoom number so
      // bubbles only repaint when crossing a tier boundary, not on
      // every animation tick.
      const nextBucket: 'wide' | 'mid' | 'tight' =
        zoom < 13 ? 'wide' : zoom < 15 ? 'mid' : 'tight';
      if (nextBucket !== marketZoomBucketRef.current) {
        marketZoomBucketRef.current = nextBucket;
        setMarketZoom(nextBucket === 'wide' ? 11 : nextBucket === 'mid' ? 14 : 16);
      }
    });

    // Set initial state in case map starts zoomed out
    if (map.getZoom() < 12) {
      markersVisible = false;
      markersVisibleRef.current = false;
    }

    map.on('load', () => {
      // ── Globe-view fog: deep purple atmosphere with magenta rim ──
      // Visible primarily at low zoom (≤ ~5) when the globe projection
      // is active. Auto-fades into a Mercator view as the user zooms in.
      try {
        map.setFog({
          'color':          'rgba(100, 80, 180, 0.4)',
          'high-color':     'rgba(200, 100, 220, 0.5)',
          'horizon-blend':  0.05,
          'space-color':    'rgba(10, 14, 28, 1.0)',
          'star-intensity': 0.6,
        });
      } catch (err) {
        console.warn('[MapView] setFog failed:', err);
      }

      // ── City dots (globe view) — one Point per launch market.
      // Source data is populated from the cityAggregates prop in a
      // separate effect below; we set up empty here so the layers
      // exist by the time aggregates arrive.
      map.addSource('venuu-cities', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Outer pulse ring — added FIRST so the inner dot stays on top.
      map.addLayer({
        id: 'city-dots-pulse',
        type: 'circle',
        source: 'venuu-cities',
        minzoom: 0,
        maxzoom: 6,
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            0, 12, 2, 18, 4, 28, 6, 0,
          ],
          'circle-color': [
            'match', ['get', 'dominantState'],
            'Surging', '#1FE89A',
            'Packed',  '#7D1C33',
            'Busy',    '#8B4023',
            'Lively',  '#B58A2C',
            'Quiet',   '#5E4480',
            '#5E4480',
          ],
          'circle-opacity': 0.0, // breath-loop animates this
          'circle-blur': 0.4,
          'circle-stroke-width': 0,
        },
      });

      // Inner solid dot — sits on top of the pulse ring.
      map.addLayer({
        id: 'city-dots-inner',
        type: 'circle',
        source: 'venuu-cities',
        minzoom: 0,
        maxzoom: 6,
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            0, 6, 2, 8, 4, 14, 6, 0,
          ],
          'circle-color': [
            'match', ['get', 'dominantState'],
            'Surging', '#1FE89A',
            'Packed',  '#7D1C33',
            'Busy',    '#8B4023',
            'Lively',  '#B58A2C',
            'Quiet',   '#5E4480',
            '#5E4480',
          ],
          'circle-opacity': 0.95,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(255, 255, 255, 0.5)',
        },
      });

      // City dot tap → fly down to the city + tell parent to switch.
      map.on('click', 'city-dots-inner', (e) => {
        const f = e.features?.[0];
        if (!f || !f.geometry || f.geometry.type !== 'Point') return;
        const coords = f.geometry.coordinates as [number, number];
        const cityKey = (f.properties?.city ?? '') as CityKey;
        map.flyTo({
          center: coords,
          zoom: 13.5,
          pitch: 45,
          bearing: -8,
          duration: 2200,
          curve: 1.42,
          essential: true,
        });
        if (cityKey) onCityTapFromGlobeRef.current?.(cityKey);
      });
      map.on('mouseenter', 'city-dots-inner', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'city-dots-inner', () => {
        map.getCanvas().style.cursor = '';
      });

      // City-dot pulse loop — 1.6s sinusoidal opacity breath.
      const pulseStartedAt = performance.now();
      const tickPulse = (now: number) => {
        if (!map.getLayer('city-dots-pulse')) return;
        const elapsed = (now - pulseStartedAt) / 1000;
        const opacity = 0.4 + 0.3 * Math.sin((elapsed * 2 * Math.PI) / 1.6);
        try {
          map.setPaintProperty('city-dots-pulse', 'circle-opacity', opacity);
        } catch {
          // layer briefly gone during a style swap — next tick recovers
        }
        cityPulseFrameRef.current = requestAnimationFrame(tickPulse);
      };
      cityPulseFrameRef.current = requestAnimationFrame(tickPulse);

      // ── Event pill background image (SDF 1×1 pixel used with icon-text-fit) ──
      const pillData = new Uint8Array([0, 0, 0, 217]); // rgba(0,0,0,0.85)
      map.addImage('event-pill-bg', { width: 1, height: 1, data: pillData }, { sdf: true });

      // ── Power T — fixed geographic marker at UTK campus ──
      const tEl = document.createElement('div');
      tEl.className = 'power-t-marker';
      tEl.innerHTML = `<svg width="32" height="32" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <rect x="6" y="4" width="52" height="16" rx="3" fill="#FF8200"/>
        <rect x="22" y="18" width="20" height="42" rx="3" fill="#FF8200"/>
      </svg>`;

      const tMarker = new mapboxgl.Marker({ element: tEl, anchor: 'center' })
        .setLngLat([-83.9295, 35.9544])
        .addTo(map);

      const tWrapperEl = tMarker.getElement();
      tWrapperEl.style.transition = 'none';
      tWrapperEl.style.willChange = 'transform';

      tMarkerRef.current = tMarker;

      // ── Route layers (gradient energy flow) ──
      // Trail: faded gray line showing where user walked
      map.addSource('route-trail', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'route-trail',
        type: 'line',
        source: 'route-trail',
        paint: { 'line-color': '#8A8A95', 'line-width': 3, 'line-opacity': 0.15 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });

      // Main route: gradient from user → destination
      map.addSource('route-source', {
        type: 'geojson',
        lineMetrics: true,
        data: { type: 'FeatureCollection', features: [] },
      });

      // Glow layer (wide, blurred gradient)
      map.addLayer({
        id: 'route-glow',
        type: 'line',
        source: 'route-source',
        paint: {
          'line-width': 16,
          'line-opacity': 0.3,
          'line-blur': 6,
          'line-gradient': [
            'interpolate', ['linear'], ['line-progress'],
            0, '#FFFFFF',
            0.15, '#FF8200',
            0.5, '#FF4500',
            0.85, '#00D4FF',
            1.0, '#00FF88',
          ],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });

      // Main gradient line
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route-source',
        paint: {
          'line-width': 6,
          'line-opacity': 0.9,
          'line-gradient': [
            'interpolate', ['linear'], ['line-progress'],
            0, '#FFFFFF',
            0.15, '#FF8200',
            0.5, '#FF4500',
            0.85, '#00D4FF',
            1.0, '#00FF88',
          ],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });

      // Particle dot that travels along the route
      map.addSource('route-particle', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'route-particle-glow',
        type: 'circle',
        source: 'route-particle',
        paint: { 'circle-radius': 12, 'circle-color': '#FFFFFF', 'circle-opacity': 0.4, 'circle-blur': 1 },
      });
      map.addLayer({
        id: 'route-particle-dot',
        type: 'circle',
        source: 'route-particle',
        paint: { 'circle-radius': 4, 'circle-color': '#FFFFFF', 'circle-opacity': 0.9 },
      });

      // ── Event GeoJSON layers — electric blue pulsing glow ──
      map.addSource('events-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Radar ping ring 1 (fast, 3s cycle)
      map.addLayer({
        id: 'events-ping1',
        type: 'circle',
        source: 'events-source',
        minzoom: 11,
        paint: {
          'circle-radius': 15,
          'circle-color': 'transparent',
          'circle-opacity': 0,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#00D4FF',
          'circle-stroke-opacity': 0.5,
        },
      });

      // Radar ping ring 2 (medium, 4.5s cycle, 1.5s offset)
      map.addLayer({
        id: 'events-ping2',
        type: 'circle',
        source: 'events-source',
        minzoom: 11,
        paint: {
          'circle-radius': 15,
          'circle-color': 'transparent',
          'circle-opacity': 0,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#4FC3F7',
          'circle-stroke-opacity': 0.5,
        },
      });

      // Radar ping ring 3 (wide, 6s cycle, 2s offset) — third concentric ring
      map.addLayer({
        id: 'events-ping3',
        type: 'circle',
        source: 'events-source',
        minzoom: 11,
        paint: {
          'circle-radius': 15,
          'circle-color': 'transparent',
          'circle-opacity': 0,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#4FC3F7',
          'circle-stroke-opacity': 0.35,
        },
      });

      // Layer 0: wide aura (very faint, animated at different speed)
      map.addLayer({
        id: 'events-aura',
        type: 'circle',
        source: 'events-source',
        minzoom: 11,
        paint: {
          'circle-radius': ['case', ['==', ['get', 'isFratEvent'], 1], 45, 50],
          'circle-color': ['case', ['==', ['get', 'isFratEvent'], 1], '#7EB8FF', '#00D4FF'],
          'circle-opacity': ['case', ['==', ['get', 'isFratEvent'], 1], 0.06, 0.03],
          'circle-blur': 1,
        },
      });

      // Layer 1: outermost glow
      map.addLayer({
        id: 'events-glow',
        type: 'circle',
        source: 'events-source',
        minzoom: 11,
        paint: {
          'circle-radius': 35,
          'circle-color': ['case', ['==', ['get', 'isFratEvent'], 1], '#7EB8FF', '#00D4FF'],
          'circle-opacity': 0.08,
          'circle-blur': 1,
        },
      });

      // Layer 2: animated pulse ring
      map.addLayer({
        id: 'events-pulse',
        type: 'circle',
        source: 'events-source',
        minzoom: 11,
        paint: {
          'circle-radius': 25,
          'circle-color': ['case', ['==', ['get', 'isFratEvent'], 1], '#7EB8FF', '#00D4FF'],
          'circle-opacity': 0.15,
        },
      });

      // Layer 3: inner ring
      map.addLayer({
        id: 'events-ring',
        type: 'circle',
        source: 'events-source',
        minzoom: 11,
        paint: {
          'circle-radius': 15,
          'circle-color': ['case', ['==', ['get', 'isFratEvent'], 1], '#7EB8FF', '#0088FF'],
          'circle-opacity': 0.3,
        },
      });

      // Layer 4: core dot — electric green, larger and brighter
      map.addLayer({
        id: 'events-core',
        type: 'circle',
        source: 'events-source',
        minzoom: 11,
        paint: {
          'circle-radius': 10,
          'circle-color': '#00FF88',
          'circle-opacity': 1,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-opacity': 0.9,
        },
      });

      // Layer 5: event title + time label — solid pill background above marker
      map.addLayer({
        id: 'events-label',
        type: 'symbol',
        source: 'events-source',
        minzoom: 11,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Arial Unicode MS Bold'],
          'text-size': 13,
          'text-offset': [0, -4.2],
          'text-anchor': 'bottom',
          'text-max-width': 14,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'text-line-height': 1.3,
          'text-letter-spacing': 0.02,
          // Pill background via 1px SDF image stretched to text bounds
          'icon-image': 'event-pill-bg',
          'icon-text-fit': 'both',
          'icon-text-fit-padding': [6, 12, 6, 12],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'text-color': '#FFFFFF',
          'text-halo-color': 'rgba(79,195,247,0.35)',
          'text-halo-width': 1,
          'icon-color': 'rgba(0,0,0,0.88)',
          'icon-opacity': 1,
        },
      });

      // ── User location dot ──
      map.addSource('user-location', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Accuracy circle (very faint)
      map.addLayer({
        id: 'user-accuracy',
        type: 'circle',
        source: 'user-location',
        paint: {
          'circle-radius': ['get', 'accuracyRadius'],
          'circle-color': '#FF8200',
          'circle-opacity': 0.05,
        },
      });

      // Pulse ring (animated)
      map.addLayer({
        id: 'user-pulse',
        type: 'circle',
        source: 'user-location',
        paint: {
          'circle-radius': 10,
          'circle-color': '#FF8200',
          'circle-opacity': 0.3,
        },
      });

      // Inner dot (white with orange border)
      map.addLayer({
        id: 'user-dot',
        type: 'circle',
        source: 'user-location',
        paint: {
          'circle-radius': 6,
          'circle-color': '#FFFFFF',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#FF8200',
        },
      });

      // ── 3D Buildings (hidden by default, shown when pitch > 20) ──
      map.addLayer({
        id: '3d-buildings',
        source: 'composite',
        'source-layer': 'building',
        filter: ['==', 'extrude', 'true'],
        type: 'fill-extrusion',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': '#1a1a2e',
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': ['get', 'min_height'],
          'fill-extrusion-opacity': 0,  // starts hidden, fades in with pitch
        },
      });

      // ── Night sky (visible when pitch > 30) ──
      map.addLayer({
        id: 'sky',
        type: 'sky',
        paint: {
          'sky-type': 'atmosphere',
          'sky-atmosphere-sun': [0, -20],
          'sky-atmosphere-sun-intensity': 2,
          'sky-atmosphere-color': '#0D0D12',
        },
      });

      // ── Nighttime atmosphere: darken water, parks, roads ──
      try {
        map.setPaintProperty('water', 'fill-color', '#0a0a14');
      } catch { /* layer may not exist in style */ }
      try {
        map.setPaintProperty('landuse', 'fill-color', '#0d1a0d');
      } catch { /* layer may not exist */ }

      // ── Activity particles (fireflies between venues) ──
      map.addSource('activity-particles', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'activity-particles-glow',
        type: 'circle',
        source: 'activity-particles',
        minzoom: 12,
        paint: {
          'circle-radius': 6,
          'circle-color': '#FF8200',
          'circle-opacity': 0.15,
          'circle-blur': 1,
        },
      });
      map.addLayer({
        id: 'activity-particles-dot',
        type: 'circle',
        source: 'activity-particles',
        minzoom: 12,
        paint: {
          'circle-radius': 2,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.5,
        },
      });

      setMapLoaded(true);
    });

    mapRef.current = map;
    if (mapInstanceRef) mapInstanceRef.current = map;
    if (onMapReady) onMapReady(map);

    // ── Fix black tiles: resize on visibility change, window resize, app foreground ──
    const handleResize = () => {
      if (mapRef.current) {
        mapRef.current.resize();
        mapRef.current.triggerRepaint();
      }
    };

    // Tab becomes visible (user switches back to Tonight tab — display:none → visible)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Small delay lets the layout settle after display:none is removed
        setTimeout(handleResize, 100);
      }
    };

    // App returns from background on iOS (Capacitor fires resume)
    const handleResume = () => { setTimeout(handleResize, 100); };

    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('resume', handleResume);

    // Also observe the container becoming visible (catches tab switches via className='hidden')
    let resizeObserver: ResizeObserver | null = null;
    if (mapContainer.current) {
      resizeObserver = new ResizeObserver(() => {
        // Only fire when container has non-zero dimensions (became visible)
        if (mapContainer.current && mapContainer.current.offsetHeight > 0) {
          handleResize();
        }
      });
      resizeObserver.observe(mapContainer.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('resume', handleResume);
      resizeObserver?.disconnect();
      cancelAnimationFrame(animFrameRef.current);
      if (cityPulseFrameRef.current) cancelAnimationFrame(cityPulseFrameRef.current);
      markersRef.current.forEach(entry => {
        try { entry.reactRoot.unmount(); } catch { /* noop */ }
        entry.marker.remove();
      });
      markersRef.current.clear();
      if (tMarkerRef.current) {
        tMarkerRef.current.remove();
        tMarkerRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      if (mapInstanceRef) mapInstanceRef.current = null;
      setMapLoaded(false);
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const map = mapRef.current;
    const handleClick = (e: mapboxgl.MapMouseEvent) => {
      // Don't dismiss cards when tapping on event markers
      const hitLayers = EVENT_LAYERS.filter(l => map.getLayer(l));
      if (hitLayers.length > 0) {
        const hits = map.queryRenderedFeatures(e.point, { layers: hitLayers as unknown as string[] });
        if (hits.length > 0) return;
      }
      onMapTap?.();
    };
    map.on('click', handleClick);
    return () => { map.off('click', handleClick); };
  }, [mapLoaded, onMapTap]);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const map = mapRef.current;
    const config = CITIES[city];
    map.flyTo({
      center: [config.center.lng, config.center.lat],
      zoom: config.zoom,
      duration: 1500,
      essential: true,
    });
    // Force re-render after fly completes to fix black tiles
    const onMoveEnd = () => {
      map.resize();
      map.triggerRepaint();
      map.off('moveend', onMoveEnd);
    };
    map.on('moveend', onMoveEnd);
  }, [city, mapLoaded]);

  const syncMarkers = useCallback(() => {
    if (!mapRef.current || !mapLoaded) return;
    const currentIds = new Set(venues.map(v => v.id));

    markersRef.current.forEach((entry, id) => {
      if (!currentIds.has(id)) {
        // Tear down the React root before removing the marker so the
        // attached LiveVenueBubble unmounts cleanly.
        try {
          entry.reactRoot.unmount();
        } catch {
          // unmount can throw during fast Strict-Mode tear-downs — safe to ignore
        }
        entry.marker.remove();
        markersRef.current.delete(id);
      }
    });

    venues.forEach(venue => {
      if (markersRef.current.has(venue.id)) return;

      const el = document.createElement('div');
      el.className = 'venue-marker';
      el.setAttribute('data-venue-id', venue.id);

      // Main bubble
      const bubbleEl = document.createElement('div');
      bubbleEl.className = 'venue-bubble';
      const initVisuals = getVenueVisuals(0);
      bubbleEl.style.width = `${initVisuals.size}px`;
      bubbleEl.style.height = `${initVisuals.size}px`;
      bubbleEl.style.background = initVisuals.color;
      bubbleEl.style.boxShadow = initVisuals.glow;

      // Count inside bubble
      const countEl = document.createElement('span');
      countEl.className = 'venue-bubble-count';
      bubbleEl.appendChild(countEl);

      // Outer ring (hidden by default, shown for active venues)
      const ringEl = document.createElement('div');
      ringEl.className = 'venue-ring';
      ringEl.style.display = 'none';

      // Second ring (hidden by default, shown for 100+ double ring)
      const ring2El = document.createElement('div');
      ring2El.className = 'venue-ring';
      ring2El.style.display = 'none';

      // Heat glow (hidden by default, shown for active venues)
      const glowEl = document.createElement('div');
      glowEl.className = 'venue-heat-glow';
      glowEl.style.display = 'none';

      // Orbiting particles (hidden by default, shown for 100+)
      const particlesEl = document.createElement('div');
      particlesEl.className = 'venue-particles';
      particlesEl.style.display = 'none';
      particlesEl.innerHTML = '<i class="vp vp1"></i><i class="vp vp2"></i><i class="vp vp3"></i>';

      // Cover charge bubble
      const coverEl = document.createElement('div');
      coverEl.className = 'venue-cover-bubble';
      const initCover = venue.cover_charge;
      coverEl.textContent = initCover ? getCoverLabel(initCover) : 'FREE';
      bubbleEl.appendChild(coverEl);

      // Featured badge (crown emoji, top-left of bubble)
      const featuredBadgeEl = document.createElement('div');
      featuredBadgeEl.className = 'venue-featured-badge';
      featuredBadgeEl.textContent = '\u{1F451}';
      featuredBadgeEl.style.display = 'none';
      bubbleEl.appendChild(featuredBadgeEl);

      // Label below
      const labelEl = document.createElement('div');
      labelEl.className = 'venue-label';
      labelEl.textContent = getShortName(venue.name);

      // Featured label below venue name
      const featuredLabelEl = document.createElement('div');
      featuredLabelEl.className = 'venue-featured-label';
      featuredLabelEl.style.display = 'none';

      // Live badge
      const liveEl = document.createElement('div');
      liveEl.className = 'venue-live-badge';
      liveEl.innerHTML = '<span class="blink"></span>LIVE';
      liveEl.style.display = 'none';

      // Cover price tag (hidden by default, shown when covers are active)
      const priceTagEl = document.createElement('div');
      priceTagEl.className = 'venue-price-tag';
      priceTagEl.style.display = 'none';
      priceTagEl.style.pointerEvents = 'auto';
      priceTagEl.style.cursor = 'pointer';
      priceTagEl.addEventListener('click', (e) => {
        e.stopPropagation();
        onPriceTapRef.current?.(venue.id, venue.name);
      });

      el.appendChild(glowEl);
      el.appendChild(particlesEl);
      el.appendChild(ring2El);
      el.appendChild(ringEl);
      el.appendChild(bubbleEl);
      el.appendChild(labelEl);
      el.appendChild(featuredLabelEl);
      el.appendChild(liveEl);
      el.appendChild(priceTagEl);

      // ── Prediction-engine overlay ─────────────────────────────
      // Mount point for LiveVenueBubble. Sits on top of the legacy
      // bubble; we make the legacy bubble visually invisible (but keep
      // its layout slot for marker positioning) only when an estimate
      // is present and confident enough — see syncLiveBubbles below.
      const reactMount = document.createElement('div');
      reactMount.className = 'venue-live-bubble-mount';
      reactMount.style.position = 'absolute';
      reactMount.style.top = '50%';
      reactMount.style.left = '50%';
      reactMount.style.transform = 'translate(-50%, -50%)';
      reactMount.style.display = 'none';
      reactMount.style.zIndex = '3';
      el.appendChild(reactMount);
      const reactRoot = createRoot(reactMount);

      // Initialize featured state
      const isFeatured = !!venue.featured;
      if (isFeatured) {
        featuredBadgeEl.style.display = 'flex';
        if (venue.featured_label) {
          featuredLabelEl.textContent = venue.featured_label;
          featuredLabelEl.style.display = 'block';
        }
        // Apply featured base visuals
        bubbleEl.style.background = 'linear-gradient(135deg, #7C3AED, #A855F7)';
        bubbleEl.style.width = '44px';
        bubbleEl.style.height = '44px';
        bubbleEl.style.boxShadow = '0 0 20px rgba(168, 85, 247, 0.6)';
        setAnim(bubbleEl, 'featured-breathe 3s ease-in-out infinite');
      }

      // Initialize fraternity styling
      if (venue.category === 'fraternity' && !isFeatured) {
        bubbleEl.style.background = 'linear-gradient(135deg, #F5F0EB, #EDE8E0)';
        bubbleEl.style.border = '2px solid #C9A96E';
        bubbleEl.style.boxShadow = '0 0 12px rgba(201, 169, 110, 0.3), 0 4px 12px rgba(0, 0, 0, 0.6)';
        countEl.style.color = '#C9A96E';
        countEl.style.textShadow = '0 0 10px rgba(201, 169, 110, 0.8)';
        labelEl.style.color = '#F5F0EB';
      }

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onVenueClickRef.current(venue);
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([venue.lng, venue.lat]);

      if (markersVisibleRef.current) {
        marker.addTo(mapRef.current!);
      }

      const wrapperEl = marker.getElement();
      wrapperEl.style.transition = 'none';
      wrapperEl.style.willChange = 'transform';

      markersRef.current.set(venue.id, {
        marker, el, bubbleEl, glowEl, particlesEl, ringEl, ring2El, countEl, labelEl, featuredBadgeEl, featuredLabelEl, liveEl, coverEl, priceTagEl,
        reactMount, reactRoot, hasLiveOverlay: false,
        currentStage: 0, currentCount: 0, isFeatured, isFraternity: venue.category === 'fraternity', hasEvent: false,
      });
    });
  }, [venues, mapLoaded]);

  useEffect(() => { syncMarkers(); }, [syncMarkers]);

  // ── Globe view: push city aggregates into the city-dots source ──
  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource('venuu-cities') as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    const features = (cityAggregates ?? []).map(a => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [a.centerLng, a.centerLat] },
      properties: {
        city: a.city,
        cityName: a.cityName,
        dominantState: a.dominantState,
        peopleOut: a.peopleOut,
        activeCount: a.activeCount,
      },
    }));
    src.setData({ type: 'FeatureCollection', features });
  }, [cityAggregates, mapLoaded]);

  // ── Track zoom so we know when the user is at the globe view ──
  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRef.current;
    if (!map) return;
    const handler = () => setIsAtGlobe(map.getZoom() < 4);
    handler();
    map.on('zoom', handler);
    return () => { map.off('zoom', handler); };
  }, [mapLoaded]);

  // ── Prediction-engine bubble sync ─────────────────────────────
  // For every marker, render LiveVenueBubble inside its React mount
  // when the venue has a usable (confidence ≥ 10, state ≠ Unknown)
  // estimate. Neutralise the legacy bubble visuals so the overlay is
  // the only thing the user sees. Featured + fraternity venues keep
  // their bespoke legacy styling — they aren't part of the prediction
  // pipeline yet (frats are excluded server-side; featured is a
  // different visual contract that supersedes the engine).
  useEffect(() => {
    if (!mapLoaded) return;

    // Pre-compute bloom-stagger center once per render — bubbles closer
    // to the screen center bloom first, outliers last (max 600 ms tail).
    const map = mapRef.current;
    const containerRect = (introActive && introPhase === 'bubble-bloom' && map)
      ? map.getContainer().getBoundingClientRect()
      : null;

    const highlightSet = new Set(highlightedVenueIds ?? []);
    const hasHighlight = highlightSet.size > 0;

    venues.forEach(v => {
      const entry = markersRef.current.get(v.id);
      if (!entry) return;
      if (entry.isFeatured || entry.isFraternity) return;

      const est = (v as VenueWithEstimate).headcount_estimates?.[0];
      const usable = hasUsableEstimate(est);

      let bloomDelay: number | undefined;
      if (containerRect && map) {
        try {
          const proj = map.project([v.lng, v.lat]);
          const dx = proj.x - containerRect.width / 2;
          const dy = proj.y - containerRect.height / 2;
          const distFromCenter = Math.hypot(dx, dy);
          const normalized = Math.min(distFromCenter / 400, 1);
          bloomDelay = Math.floor(normalized * 600);
        } catch {
          bloomDelay = 0;
        }
      }

      const isHighlighted = hasHighlight && highlightSet.has(v.id);

      // Venny fade dim — soften non-highlighted markers while a search
      // is active. Highlighted markers stay at full opacity and pop via
      // the lvb-highlighted CSS class. Reset opacity when highlight is
      // cleared so the legacy display path stays untouched.
      if (hasHighlight) {
        entry.el.style.opacity = isHighlighted ? '1' : '0.45';
        entry.el.style.transition = 'opacity 320ms ease-out';
        entry.el.style.zIndex = isHighlighted ? '10' : '';
      } else if (entry.el.style.opacity) {
        entry.el.style.opacity = '';
        entry.el.style.zIndex = '';
      }

      // Per-venue magnitude for the BOLD stagger curve. Falls back to
      // 0 when delta_pct is missing — those bubbles light last.
      const venueAbsDelta = typeof est?.delta_pct === 'number' ? Math.abs(est.delta_pct) : 0;
      const movementMagnitude = venueAbsDelta / maxAbsDelta;

      // Smart-density name label heuristic: top-5 mover, spotlit,
      // tight-zoom (≥ 16), or within ~500 m of the user's location.
      // Everywhere else the bubble stays anonymous to keep the map
      // legible at city zoom.
      const isVenueSpotlight = marketViewActive && v.id === spotlightVenueId;
      let showName = false;
      if (isVenueSpotlight) {
        showName = true;
      } else if (topMoverIds.has(v.id)) {
        showName = true;
      } else if (marketZoom >= 16) {
        showName = true;
      } else if (userLocation && typeof v.lat === 'number' && typeof v.lng === 'number') {
        const dKm = haversineKm(userLocation.lat, userLocation.lng, v.lat, v.lng);
        if (dKm < 0.5) showName = true;
      }

      entry.reactRoot.render(
        <LiveVenueBubble
          venueId={v.id}
          venueName={v.name}
          coverCharge={v.cover_charge}
          estimate={usable ? est : null}
          introBloomDelay={bloomDelay}
          highlighted={isHighlighted}
          mapZoom={marketZoom}
          marketView={marketViewActive}
          isSpotlight={isVenueSpotlight}
          movementMagnitude={movementMagnitude}
          showName={showName}
          vibeHueBaseline={v.vibe_hue_baseline ?? null}
        />
      );

      if (usable && !entry.hasLiveOverlay) {
        // Take over: hide legacy text, transparentise the legacy pill,
        // stop its CSS animation, and reveal the React mount.
        entry.countEl.style.opacity = '0';
        entry.bubbleEl.style.background = 'transparent';
        entry.bubbleEl.style.boxShadow = 'none';
        entry.bubbleEl.style.border = 'none';
        entry.bubbleEl.style.animation = 'none';
        entry.bubbleEl.classList.remove('active-glow');
        entry.reactMount.style.display = 'block';
        // The Signature Display is ~58px tall; the legacy label sits at
        // top:18px which lands inside the bubble's footprint. Push the
        // label down so the venue name clears the bottom edge with a
        // small breathing gap. Reset on the reverse path.
        entry.labelEl.style.top = '38px';
        entry.hasLiveOverlay = true;
      } else if (!usable && entry.hasLiveOverlay) {
        // Hand back to legacy: hide the React mount and let the existing
        // visuals-sync effect repaint the legacy bubble on next tick.
        entry.reactMount.style.display = 'none';
        entry.countEl.style.opacity = '';
        entry.bubbleEl.style.animation = '';
        entry.labelEl.style.top = ''; // legacy painter recomputes on next tick
        entry.hasLiveOverlay = false;
        entry.currentStage = -1; // force the legacy visuals sync to repaint
      }
    });
  }, [venues, mapLoaded, introActive, introPhase, highlightedVenueIds, marketZoom, marketViewActive, spotlightVenueId, maxAbsDelta, topMoverIds, userLocation]);

  // ── Venny plan route — orange polyline + glow + numbered markers ──
  // Adds a dedicated 'venny-route' source/layer pair and a set of DOM
  // markers at each stop's coordinates. The line gradient-animates
  // from start to end on first render of a given plan signature; on
  // re-render with the same plan we leave the static line alone. When
  // activePlan becomes null we tear everything down cleanly.
  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRef.current;
    if (!map) return;

    const teardown = () => {
      // Cancel any in-flight draw-in animation.
      if (planAnimRafRef.current != null) {
        cancelAnimationFrame(planAnimRafRef.current);
        planAnimRafRef.current = null;
      }
      // Remove DOM markers.
      for (const m of planMarkersRef.current) {
        try { m.remove(); } catch { /* already gone */ }
      }
      planMarkersRef.current = [];
      // Remove layers/source if present.
      for (const id of ['venny-route-line', 'venny-route-glow']) {
        if (map.getLayer(id)) {
          try { map.removeLayer(id); } catch { /* already gone */ }
        }
      }
      if (map.getSource('venny-route')) {
        try { map.removeSource('venny-route'); } catch { /* already gone */ }
      }
      planSignatureRef.current = null;
    };

    if (!activePlan || !Array.isArray(activePlan.stops) || activePlan.stops.length < 2) {
      teardown();
      return;
    }

    const stops = activePlan.stops.filter(s =>
      typeof s?.lat === 'number' && typeof s?.lng === 'number'
    );
    if (stops.length < 2) {
      teardown();
      return;
    }

    // Derive the "current" stop — first one with no arrival/skip
    // markers. Falls back to 0 if every stop is already done.
    const currentIdx = (() => {
      const idx = stops.findIndex(s =>
        !s.arrived_at && !s.visited_at && !s.skipped_at,
      );
      return idx === -1 ? Math.max(0, stops.length - 1) : idx;
    })();

    // Signature includes arrived/skipped state per stop + the focused
    // index so any state mutation triggers a marker rebuild.
    const signature = stops
      .map((s, i) => {
        const flags = `${s.arrived_at || s.visited_at ? 'a' : ''}${s.skipped_at ? 's' : ''}`;
        return `${s.venue_id}:${s.lng.toFixed(5)},${s.lat.toFixed(5)}:${flags}:${i === currentIdx ? 'c' : ''}`;
      })
      .join('|') + `::focus=${focusedStopIndex ?? -1}`;
    const sameAsLast = signature === planSignatureRef.current;
    if (sameAsLast) return;

    teardown();
    planSignatureRef.current = signature;

    const coords: [number, number][] = stops.map(s => [s.lng, s.lat]);

    // 1. Source — full LineString. We animate by overwriting `data` on
    //    every RAF tick with a progressively-longer slice. Simple,
    //    portable across Mapbox versions, no line-gradient needed.
    map.addSource('venny-route', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [coords[0]] },
      },
    });

    // 2. Glow first so the main line paints above it.
    map.addLayer({
      id: 'venny-route-glow',
      type: 'line',
      source: 'venny-route',
      paint: {
        'line-color': '#FF8200',
        'line-width': 12,
        'line-opacity': 0.25,
        'line-blur': 4,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    // 3. Main route line.
    map.addLayer({
      id: 'venny-route-line',
      type: 'line',
      source: 'venny-route',
      paint: {
        'line-color': '#FF8200',
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 5],
        'line-opacity': 0.9,
        'line-blur': 0.5,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });

    // 4. Plan stop markers — visual lives in .map-plan-marker* (CSS).
    //    Variant is derived from each stop's arrived/skipped flags
    //    plus the derived currentIdx. Focused stop (from the sheet's
    //    progress strip) gets a one-shot scale pulse via the
    //    --focused modifier class.
    stops.forEach((stop, i) => {
      const isVisited = !!(stop.arrived_at || stop.visited_at);
      const isSkipped = !!stop.skipped_at && !isVisited;
      const variant: 'arrived' | 'skipped' | 'current' | 'upcoming' = isVisited
        ? 'arrived'
        : isSkipped
          ? 'skipped'
          : i === currentIdx
            ? 'current'
            : 'upcoming';

      const el = document.createElement('div');
      el.className = `map-plan-marker map-plan-marker--${variant}`;
      if (focusedStopIndex === i && variant !== 'current') {
        el.classList.add('map-plan-marker--focused');
      }
      el.setAttribute('aria-label', `Stop ${i + 1}: ${stop.venue_name}`);
      el.style.zIndex = '20';
      el.style.setProperty('-webkit-tap-highlight-color', 'transparent');

      if (variant === 'arrived') {
        el.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
          '<path d="M2 7L5.5 10.5L12 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>';
      } else if (variant === 'skipped') {
        const span = document.createElement('span');
        span.textContent = '×';
        span.style.lineHeight = '1';
        span.style.fontSize = '18px';
        el.appendChild(span);
      } else {
        const span = document.createElement('span');
        span.textContent = String(i + 1);
        el.appendChild(span);
      }

      const handler = (evt: Event) => {
        evt.stopPropagation();
        onPlanStopTapRef.current?.(i);
      };
      el.addEventListener('click', handler);
      el.addEventListener('touchend', handler);

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([stop.lng, stop.lat])
        .addTo(map);
      planMarkersRef.current.push(marker);
    });

    // 5. fitBounds — show the whole route with breathing room. The
    //    bottom padding adapts to the sheet state so the route stays
    //    visible above the sheet (no plan stops hidden behind it).
    try {
      const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
      const bottomPad =
        sheetState === 'full' ? Math.round(winH * 0.50) :
        sheetState === 'card' ? Math.round(winH * 0.40) :
        120;
      const bounds = coords.reduce(
        (b, c) => b.extend(c as [number, number]),
        new mapboxgl.LngLatBounds(coords[0], coords[0]),
      );
      map.fitBounds(bounds, {
        padding: { top: 100, bottom: bottomPad, left: 60, right: 60 },
        duration: 1200,
        essential: true,
      });
    } catch {
      /* swallow — map sometimes refuses fitBounds during entrance anim */
    }

    // 6. Draw-in animation over ~1500 ms. Interpolate intermediate
    //    points along each segment so the line grows smoothly.
    const totalDuration = 1500;
    const start = performance.now();
    const animate = () => {
      const elapsed = performance.now() - start;
      const t = Math.min(1, elapsed / totalDuration);
      const drawn = drawLineProgress(coords, t);
      const src = map.getSource('venny-route') as mapboxgl.GeoJSONSource | undefined;
      if (src) {
        src.setData({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: drawn },
        });
      }
      if (t < 1) {
        planAnimRafRef.current = requestAnimationFrame(animate);
      } else {
        planAnimRafRef.current = null;
      }
    };
    planAnimRafRef.current = requestAnimationFrame(animate);

    return () => {
      // Effect re-runs (or unmount) → tear it all down so subsequent
      // renders start clean.
      teardown();
    };
  }, [mapLoaded, activePlan, focusedStopIndex, sheetState]);

  // ── Filter pill visibility — show/hide markers via CSS, never delete them ──
  useEffect(() => {
    if (!mapLoaded) return;
    markersRef.current.forEach((entry, venueId) => {
      const venue = venuesRef.current.find(v => v.id === venueId);
      if (!venue) return;
      const visible = !venueFilter || venueFilter === 'all'
        || (venueFilter === 'bars' && venue.category !== 'fraternity')
        || (venueFilter === 'greek' && venue.category === 'fraternity');
      entry.el.style.display = visible ? '' : 'none';
    });
  }, [venueFilter, mapLoaded]);

  // ── Fetch walking routes for activity particles ──
  useEffect(() => {
    if (!mapLoaded) return;
    // Collect active venues (headcount > 0)
    const active: { id: string; lng: number; lat: number }[] = [];
    for (const v of venues) {
      if ((counts[v.id] ?? 0) > 0) active.push({ id: v.id, lng: v.lng, lat: v.lat });
    }
    if (active.length < 2) return;

    fetchRoutesForParticles(active, mapboxToken, routeCacheRef.current).then(cache => {
      routeCacheRef.current = cache;
      // Reset particles so they pick up new routes
      particlesRef.current = [];
    });
  }, [venues, counts, mapLoaded]);

  // ── Map entrance animation: dramatic city reveal on first load ──
  useEffect(() => {
    if (!mapRef.current || !mapLoaded || entrancePlayedRef.current) return;
    if (venues.length === 0) return; // wait for venues
    entrancePlayedRef.current = true;
    const map = mapRef.current;

    // Start high, sweep down into city
    const config = CITIES[city];
    map.jumpTo({ center: [config.center.lng, config.center.lat], zoom: 4, pitch: 0, bearing: 0 });

    // Hide all venue markers initially
    markersRef.current.forEach(entry => {
      entry.el.style.opacity = '0';
      entry.el.style.transform = 'scale(0.5)';
    });

    // Dramatic fly-in
    setTimeout(() => {
      map.flyTo({
        center: [config.center.lng, config.center.lat],
        zoom: config.zoom,
        pitch: 30,
        duration: 2200,
        essential: true,
      });

      // Stagger venue marker reveals after fly starts settling
      setTimeout(() => {
        let i = 0;
        markersRef.current.forEach(entry => {
          setTimeout(() => {
            entry.el.style.transition = 'opacity 300ms ease-out, transform 300ms ease-out';
            entry.el.style.opacity = '1';
            entry.el.style.transform = 'scale(1)';
          }, i * 50);
          i++;
        });
      }, 1400); // start revealing during the last part of the fly
    }, 200);
  }, [mapLoaded, venues.length, city]);

  // ── Apply heat map visuals based on headcounts ──
  useEffect(() => {
    // Build set of venue IDs with active events
    const eventVenueIds = new Set<string>();
    if (events) {
      for (const evt of events) {
        if (evt.venue_id && evt.is_active) eventVenueIds.add(evt.venue_id);
      }
    }

    markersRef.current.forEach((entry, venueId) => {
      // Prediction-engine overlay owns the bubble visual for this venue —
      // skip the legacy heat-map painter so it doesn't fight the React
      // overlay back into existence each tick.
      if (entry.hasLiveOverlay) return;

      const count = counts[venueId] ?? 0;
      const isLive = liveVenueIds.has(venueId);
      const isPulsed = pulsedVenueId === venueId;
      const hasEvent = eventVenueIds.has(venueId);
      const visuals = getVenueVisuals(count);

      // Update bubble visuals when stage changes
      if (visuals.stage !== entry.currentStage) {
        if (entry.isFeatured) {
          // Featured: always purple gradient, min 44px, special glow
          const featuredSize = Math.max(44, visuals.size);
          entry.bubbleEl.style.width = `${featuredSize}px`;
          entry.bubbleEl.style.height = `${featuredSize}px`;
          entry.bubbleEl.style.background = 'linear-gradient(135deg, #7C3AED, #A855F7)';
          entry.bubbleEl.style.boxShadow = count > 0
            ? '0 0 30px rgba(168, 85, 247, 0.8)'
            : '0 0 20px rgba(168, 85, 247, 0.6)';
          setAnim(entry.bubbleEl, 'featured-breathe 3s ease-in-out infinite');
          entry.bubbleEl.style.fontSize = visuals.fontSize;
          // Adjust label for featured size
          entry.labelEl.style.top = `${featuredSize / 2 + 6}px`;
          entry.featuredLabelEl.style.top = `${featuredSize / 2 + 20}px`;
        } else if (entry.isFraternity) {
          // Fraternity: marble white with gold glow
          entry.bubbleEl.style.width = `${visuals.size}px`;
          entry.bubbleEl.style.height = `${visuals.size}px`;
          entry.bubbleEl.style.background = 'linear-gradient(135deg, #F5F0EB, #EDE8E0)';
          const fratGlow = count > 0
            ? `0 0 ${12 + visuals.stage * 5}px rgba(201, 169, 110, 0.5), 0 4px 12px rgba(0,0,0,0.6)`
            : '0 0 10px rgba(201, 169, 110, 0.25), 0 4px 12px rgba(0,0,0,0.6)';
          entry.bubbleEl.style.boxShadow = fratGlow;
          setAnim(entry.bubbleEl, visuals.pulse);
          entry.bubbleEl.style.fontSize = visuals.fontSize;
          entry.countEl.style.color = '#C9A96E';
        } else {
          entry.bubbleEl.style.width = `${visuals.size}px`;
          entry.bubbleEl.style.height = `${visuals.size}px`;
          entry.bubbleEl.style.background = visuals.color;
          entry.bubbleEl.style.boxShadow = visuals.glow;
          setAnim(entry.bubbleEl, visuals.pulse);
          entry.bubbleEl.style.fontSize = visuals.fontSize;
        }

        // Tiered pulse rings for all active venues
        if (count > 0) {
          const ringColor = entry.isFraternity ? '#C9A96E' : visuals.color;
          const ringSize = visuals.size + 16;
          entry.ringEl.style.display = 'block';
          entry.ringEl.style.width = `${ringSize}px`;
          entry.ringEl.style.height = `${ringSize}px`;
          entry.ringEl.style.border = `2px solid ${ringColor}`;

          if (count <= 15) {
            // Slow single ring
            setAnim(entry.ringEl, 'ring-slow 2.5s ease-out infinite');
            entry.ring2El.style.display = 'none';
          } else if (count <= 50) {
            // Medium single ring
            setAnim(entry.ringEl, 'ring-medium 2s ease-out infinite');
            entry.ring2El.style.display = 'none';
          } else if (count <= 100) {
            // Fast single ring
            setAnim(entry.ringEl, 'ring-fast 1.5s ease-out infinite');
            entry.ring2El.style.display = 'none';
          } else {
            // 100+: DOUBLE ring + glow
            setAnim(entry.ringEl, 'ring-double-inner 1.2s ease-out infinite');
            entry.ring2El.style.display = 'block';
            entry.ring2El.style.width = `${ringSize + 8}px`;
            entry.ring2El.style.height = `${ringSize + 8}px`;
            entry.ring2El.style.border = `2px solid ${visuals.color}`;
            setAnim(entry.ring2El, 'ring-double-outer 1.2s ease-out infinite 0.3s');
            // Glowing box-shadow matching bubble color
            entry.bubbleEl.style.boxShadow = `${visuals.glow}, 0 0 20px ${visuals.color}40`;
          }
        } else {
          entry.ringEl.style.display = 'none';
          entry.ring2El.style.display = 'none';
        }

        // Heat glow behind ALL active venue bubbles (+ featured always-on)
        // Uses radial-gradient instead of filter:blur() for iOS WKWebView compat
        const glowColor = entry.isFeatured ? '#A855F7' : entry.isFraternity ? '#C9A96E' : visuals.color;
        const applyGlow = (sz: number, opacity: number) => {
          entry.glowEl.style.display = 'block';
          entry.glowEl.style.width = `${sz}px`;
          entry.glowEl.style.height = `${sz}px`;
          entry.glowEl.style.background = `radial-gradient(circle, ${glowColor} 0%, transparent 70%)`;
          entry.glowEl.style.opacity = String(opacity);
          entry.glowEl.style.filter = 'none';
          setAnim(entry.glowEl, 'heat-glow-breathe 4s ease-in-out infinite');
        };
        if (entry.isFeatured && count === 0) {
          applyGlow(84, 0.35);
        } else if (count >= 100) {
          const sz = (entry.isFeatured ? Math.max(44, visuals.size) : visuals.size) + 80;
          applyGlow(sz, 0.5);
        } else if (count >= 51) {
          const sz = (entry.isFeatured ? Math.max(44, visuals.size) : visuals.size) + 55;
          applyGlow(sz, 0.4);
        } else if (count >= 16) {
          const sz = (entry.isFeatured ? Math.max(44, visuals.size) : visuals.size) + 35;
          applyGlow(sz, 0.3);
        } else if (count >= 1) {
          const sz = (entry.isFeatured ? Math.max(44, visuals.size) : visuals.size) + 20;
          applyGlow(sz, 0.2);
        } else {
          entry.glowEl.style.display = 'none';
        }

        // Orbiting particles for 100+ headcount
        if (count >= 100) {
          entry.particlesEl.style.display = 'block';
          // Set particle color via CSS custom property
          entry.particlesEl.style.setProperty('--pc', glowColor);
        } else {
          entry.particlesEl.style.display = 'none';
        }

        // Adjust label position based on bubble size (non-featured)
        if (!entry.isFeatured) {
          entry.labelEl.style.top = `${visuals.size / 2 + 6}px`;
        }

        // Inner glow class for active bubbles
        if (count > 0 || entry.isFeatured) {
          entry.bubbleEl.classList.add('active-glow');
        } else {
          entry.bubbleEl.classList.remove('active-glow');
        }

        entry.currentStage = visuals.stage;
      }

      // ── Event-charged venue override ──
      // When a venue has an active event, turn the dot electric blue
      if (hasEvent !== entry.hasEvent) {
        entry.hasEvent = hasEvent;
        if (hasEvent && !entry.isFeatured) {
          entry.bubbleEl.style.background = '#00D4FF';
          entry.bubbleEl.style.boxShadow = '0 0 16px rgba(0, 212, 255, 0.6)';
          setAnim(entry.bubbleEl, 'event-charged-pulse 2s ease-in-out infinite');
          // Also tint the DOM ring blue if visible
          if (count > 0) {
            entry.ringEl.style.border = '2px solid #00D4FF';
            if (entry.ring2El.style.display === 'block') {
              entry.ring2El.style.border = '2px solid #00D4FF';
            }
          }
          // Tint glow blue
          if (entry.glowEl.style.display !== 'none') {
            entry.glowEl.style.background = 'radial-gradient(circle, #00D4FF 0%, transparent 70%)';
          }
        } else if (!hasEvent && !entry.isFeatured) {
          // Revert to normal — force stage recalc next cycle
          entry.bubbleEl.style.background = visuals.color;
          entry.bubbleEl.style.boxShadow = visuals.glow;
          setAnim(entry.bubbleEl, visuals.pulse);
          if (count > 0) {
            entry.ringEl.style.border = `2px solid ${visuals.color}`;
          }
        }
      }

      // Update count text with animated ticker + font size
      if (count !== entry.currentCount) {
        entry.bubbleEl.style.fontSize = visuals.fontSize;
        if (visuals.showCount) {
          animateCountTo(entry.countEl, entry.currentCount, count, formatCount);
        } else {
          entry.countEl.textContent = '';
        }
        if (count > 0 && entry.currentCount > 0) {
          entry.countEl.classList.remove('bumping');
          void entry.countEl.offsetWidth;
          entry.countEl.classList.add('bumping');
        }
        entry.currentCount = count;
      }

      // Live badge
      entry.liveEl.style.display = isLive ? 'flex' : 'none';

      // Pulsed venue feedback
      if (isPulsed) {
        entry.bubbleEl.style.transition = 'none';
        entry.bubbleEl.style.transform = 'translate(-50%, -50%) scale(1.2)';
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            entry.bubbleEl.style.transition = 'transform 0.4s ease-out';
            entry.bubbleEl.style.transform = 'translate(-50%, -50%) scale(1)';
          });
        });
      }
    });
  }, [counts, liveVenueIds, pulsedVenueId, events, mapLoaded]);

  // ── Cover bubble sync ──
  useEffect(() => {
    if (!mapLoaded) return;

    venues.forEach(venue => {
      const entry = markersRef.current.get(venue.id);
      if (!entry) return;
      const cover = venue.cover_charge;
      const newText = cover ? getCoverLabel(cover) : 'FREE';
      if (entry.coverEl.textContent !== newText) {
        entry.coverEl.textContent = newText;
      }
    });
  }, [venues, mapLoaded]);

  // ── Cover price tags on venue markers ──
  useEffect(() => {
    if (!mapLoaded) return;
    const priceCount = coverPrices?.size ?? 0;
    if (priceCount > 0) console.debug(`[covers] Rendering ${priceCount} price tags`);
    markersRef.current.forEach((entry, venueId) => {
      const info = coverPrices?.get(venueId);
      if (!info) { entry.priceTagEl.style.display = 'none'; return; }

      entry.priceTagEl.style.display = 'flex';

      if (info.isSoldOut) {
        // Sold out state
        entry.priceTagEl.innerHTML = `<span class="pt-price" style="color:#FF2D05">SOLD OUT</span>`;
        entry.priceTagEl.classList.remove('pt-urgency');
      } else if (info.isFlat) {
        // Flat price — no arrow, no remaining
        entry.priceTagEl.innerHTML = `<span class="pt-price">${formatCoverPriceShort(info.currentPrice)}</span><span class="pt-remaining">${info.coversRemaining} left</span>`;
        entry.priceTagEl.classList.remove('pt-urgency');
      } else {
        // Dynamic pricing — full ticker
        const arrow = info.priceDirection === 'up' ? '\u2191' : info.priceDirection === 'down' ? '\u2193' : '\u2192';
        const arrowColor = info.priceDirection === 'up' ? '#00FF88' : info.priceDirection === 'down' ? '#FF8200' : '#8A8A95';
        const pctRemaining = info.capacity > 0 ? (info.coversRemaining / info.capacity) * 100 : 100;
        const urgentText = pctRemaining < 20 ? '\uD83D\uDD25 Almost gone!' : `${info.coversRemaining} left`;
        const isFratVenue = entry.isFraternity;
        const priceColor = isFratVenue ? '#C9A96E' : info.priceColor;
        entry.priceTagEl.innerHTML = `<span class="pt-price" style="color:${priceColor}">${formatCoverPriceShort(info.currentPrice)}</span><span class="pt-arrow" style="color:${arrowColor}">${arrow}</span><span class="pt-remaining" style="${pctRemaining < 20 ? 'color:#FF2D05' : ''}">${urgentText}</span>`;
        // Urgency: price within 80% of range from base→cap
        const priceRange = info.capPrice - info.basePrice;
        const isNearMax = priceRange > 0 && (info.currentPrice - info.basePrice) / priceRange >= 0.8;
        entry.priceTagEl.classList.toggle('pt-urgency', isNearMax || pctRemaining < 20);
        // Flash on price change
        if (info.currentPrice !== info.previousPrice) {
          entry.priceTagEl.classList.remove('pt-flash-up', 'pt-flash-down');
          void entry.priceTagEl.offsetWidth;
          entry.priceTagEl.classList.add(info.priceDirection === 'up' ? 'pt-flash-up' : 'pt-flash-down');
        }
      }
    });
  }, [coverPrices, mapLoaded]);

  // ── Ambient strip glow — subtle warmth when 3+ venues are active in Knoxville Strip ──
  const stripGlowRef = useRef<mapboxgl.Marker | null>(null);
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    // The Strip: Cumberland Ave area
    const STRIP_CENTER: [number, number] = [-83.9285, 35.9579];
    const STRIP_RADIUS = 0.008; // ~0.5 miles in degrees

    // Count active venues near the strip
    let activeInStrip = 0;
    venues.forEach(v => {
      const dlat = Math.abs(v.lat - STRIP_CENTER[1]);
      const dlng = Math.abs(v.lng - STRIP_CENTER[0]);
      if (dlat < STRIP_RADIUS && dlng < STRIP_RADIUS && (counts[v.id] ?? 0) > 0) {
        activeInStrip++;
      }
    });

    if (activeInStrip >= 3) {
      if (!stripGlowRef.current) {
        const el = document.createElement('div');
        el.className = 'strip-ambient-glow';
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat(STRIP_CENTER)
          .addTo(mapRef.current);
        const wrapperEl = marker.getElement();
        wrapperEl.style.transition = 'none';
        wrapperEl.style.willChange = 'transform';
        stripGlowRef.current = marker;
      }
    } else {
      if (stripGlowRef.current) {
        stripGlowRef.current.remove();
        stripGlowRef.current = null;
      }
    }
  }, [venues, counts, mapLoaded]);

  // ── Update event GeoJSON source when events or venues change ──
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const source = mapRef.current.getSource('events-source') as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(buildEventsGeoJSON(events ?? [], venues));
  }, [events, venues, mapLoaded]);

  // ── Update route source when route prop changes ──
  const prevRouteRef = useRef<GeoJSON.LineString | null>(null);
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const map = mapRef.current;
    const source = map.getSource('route-source') as mapboxgl.GeoJSONSource | undefined;
    const trailSource = map.getSource('route-trail') as mapboxgl.GeoJSONSource | undefined;
    const particleSource = map.getSource('route-particle') as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    if (route) {
      source.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: route, properties: {} }],
      });

      // Build trail from walked portion (difference between full and current visible)
      if (trailSource && prevRouteRef.current && userLocation) {
        const fullCoords = prevRouteRef.current.coordinates as [number, number][];
        const currentCoords = route.coordinates as [number, number][];
        // Trail = full route coords up to where current route starts
        if (fullCoords.length > currentCoords.length + 2) {
          const trailEnd = fullCoords.length - currentCoords.length + 1;
          const trailCoords = fullCoords.slice(0, trailEnd);
          if (trailCoords.length >= 2) {
            trailSource.setData({
              type: 'FeatureCollection',
              features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: trailCoords }, properties: {} }],
            });
          }
        }
      }

      // Fit map to route bounds with padding (only on first set, not every update)
      if (!prevRouteRef.current) {
        const coords = route.coordinates as [number, number][];
        if (coords.length > 1) {
          const bounds = coords.reduce(
            (b, c) => b.extend(c),
            new mapboxgl.LngLatBounds(coords[0], coords[0]),
          );
          map.fitBounds(bounds, { padding: { top: 100, bottom: 120, left: 50, right: 50 }, duration: 600 });
        }
      }
      prevRouteRef.current = route;
      routeCoordsRef.current = route.coordinates as [number, number][];
    } else {
      source.setData({ type: 'FeatureCollection', features: [] });
      trailSource?.setData({ type: 'FeatureCollection', features: [] });
      particleSource?.setData({ type: 'FeatureCollection', features: [] });
      prevRouteRef.current = null;
      routeCoordsRef.current = null;
    }
  }, [route, mapLoaded, userLocation]);

  // ── Update user location dot ──
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const source = mapRef.current.getSource('user-location') as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    if (userLocation) {
      // Convert accuracy (meters) to a rough pixel radius at current zoom
      // At zoom 15, ~1 meter ≈ 0.5px. Scale logarithmically.
      const metersPerPx = 156543.03 * Math.cos(userLocation.lat * Math.PI / 180) / Math.pow(2, mapRef.current.getZoom());
      const accuracyRadius = Math.min(Math.max(userLocation.accuracy / metersPerPx, 8), 100);

      source.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [userLocation.lng, userLocation.lat] },
          properties: { accuracyRadius },
        }],
      });
    } else {
      source.setData({ type: 'FeatureCollection', features: [] });
    }
  }, [userLocation, mapLoaded]);

  // ── Follow-mode: center/bearing on user location with cinematic transitions ──
  const prevFollowRef = useRef<string>('free');
  useEffect(() => {
    if (!mapRef.current || !mapLoaded || !userLocation) return;
    const map = mapRef.current;
    const wasMode = prevFollowRef.current;
    prevFollowRef.current = followMode ?? 'free';

    if (followMode === 'free') {
      // Don't snap pitch/bearing on exit — user may be exploring in 3D.
      // Pitch resets naturally when they cycle back to 'center' mode.
      return;
    }

    if (followMode === 'center') {
      // Settle to default tilt, north-up, centered on user
      map.easeTo({
        center: [userLocation.lng, userLocation.lat],
        pitch: 30,
        bearing: 0,
        duration: wasMode === 'bearing' ? 800 : 500,
      });
    } else if (followMode === 'bearing') {
      // Cinematic sweep into 3D — pitch up, zoom in
      map.easeTo({
        center: [userLocation.lng, userLocation.lat],
        pitch: 50,
        zoom: Math.max(map.getZoom(), 15.5),
        duration: 800,
      });
    }
  }, [userLocation, followMode, mapLoaded]);

  // Enable/disable rotation based on follow mode.
  // In center mode: disable rotation for clean north-up.
  // In free or bearing mode: enable full gestures for 3D exploration.
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const map = mapRef.current;
    const is3D = followMode !== 'center';
    if (is3D) {
      map.dragRotate.enable();
      map.touchZoomRotate.enableRotation();
      map.touchPitch.enable();
    } else {
      map.dragRotate.disable();
      map.touchZoomRotate.disableRotation();
      map.touchPitch.disable();
    }
  }, [followMode, mapLoaded]);

  // Detect user drag → reset to free mode
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const map = mapRef.current;
    const handleDrag = () => { onUserDragMap?.(); };
    map.on('dragstart', handleDrag);
    return () => { map.off('dragstart', handleDrag); };
  }, [mapLoaded, onUserDragMap]);

  // ── Unified animation loop — optimized for 30fps paint updates + 60fps particle ──
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const map = mapRef.current;
    let lastPaintFrame = 0;

    // Cache layer existence checks (layers don't appear/disappear at runtime)
    const hasEventPulse = !!map.getLayer('events-pulse');
    const hasEventAura = !!map.getLayer('events-aura');
    const hasEventGlow = !!map.getLayer('events-glow');
    const hasPing1 = !!map.getLayer('events-ping1');
    const hasPing2 = !!map.getLayer('events-ping2');
    const hasPing3 = !!map.getLayer('events-ping3');
    const hasUserPulse = !!map.getLayer('user-pulse');
    let skipSecondary = false; // skip non-critical animations when frame budget exceeded
    let lastFrameTime = 0;

    function animate() {
      const now = performance.now();

      // ── Paint property updates throttled to ~30fps (every 33ms) ──
      if (now - lastPaintFrame > 33) {
        lastPaintFrame = now;

        // Frame budget monitor: if last frame was slow, skip secondary animations
        if (lastFrameTime > 16) {
          skipSecondary = true;
          // Also reduce particle count
          if (particlesRef.current.length > 10) {
            particlesRef.current.length = Math.floor(particlesRef.current.length / 2);
          }
        } else {
          skipSecondary = false;
        }

        // Event pulse — 2s cycle
        const sin2 = Math.sin(((now % 2000) / 2000) * Math.PI * 2);
        if (hasEventPulse) {
          map.setPaintProperty('events-pulse', 'circle-radius', 25 + sin2 * 5);
          map.setPaintProperty('events-pulse', 'circle-opacity', 0.175 + sin2 * 0.075);
        }

        // Secondary animations — skipped when frame budget exceeded
        if (!skipSecondary) {
          // Event aura — 3s cycle
          const sin3 = Math.sin(((now % 3000) / 3000) * Math.PI * 2);
          if (hasEventAura) {
            map.setPaintProperty('events-aura', 'circle-radius', 50 + sin3 * 8);
            map.setPaintProperty('events-aura', 'circle-opacity', 0.03 + sin3 * 0.015);
          }

          // Radar pings
          const p1 = (now % 3000) / 3000;
          if (hasPing1) {
            map.setPaintProperty('events-ping1', 'circle-radius', 15 + p1 * 110);
            map.setPaintProperty('events-ping1', 'circle-stroke-opacity', 0.6 * (1 - p1));
          }
          const p2 = ((now + 1500) % 4500) / 4500;
          if (hasPing2) {
            map.setPaintProperty('events-ping2', 'circle-radius', 15 + p2 * 130);
            map.setPaintProperty('events-ping2', 'circle-stroke-opacity', 0.55 * (1 - p2));
          }
          const p3 = ((now + 3000) % 6000) / 6000;
          if (hasPing3) {
            map.setPaintProperty('events-ping3', 'circle-radius', 15 + p3 * 155);
            map.setPaintProperty('events-ping3', 'circle-stroke-opacity', 0.35 * (1 - p3));
          }
        }

        // User dot pulse — 2s cycle
        const uSin = Math.sin(((now % 2000) / 2000) * Math.PI * 2);
        if (hasUserPulse) {
          map.setPaintProperty('user-pulse', 'circle-radius', 15 + uSin * 5);
          map.setPaintProperty('user-pulse', 'circle-opacity', 0.2 - uSin * 0.1);
        }

        if (!skipSecondary) {
          // 3D buildings: fade in/out based on pitch (visible when pitch > 15)
          const pitch = map.getPitch();
          const buildingOpacity = pitch > 15 ? Math.min((pitch - 15) / 30, 0.5) : 0;
          if (map.getLayer('3d-buildings')) {
            map.setPaintProperty('3d-buildings', 'fill-extrusion-opacity', buildingOpacity);
          }

          // Frat event color fade: blue (#7EB8FF) ↔ marble white (#F5F0EB), 4s cycle
          const fratT = (Math.sin(now / 4000 * Math.PI * 2) + 1) / 2;
          const fr = Math.round(126 + (245 - 126) * fratT);
          const fg = Math.round(184 + (240 - 184) * fratT);
          const fb = Math.round(255 + (235 - 255) * fratT);
          const fratColor = `rgb(${fr},${fg},${fb})`;
          if (hasEventPulse) {
            map.setPaintProperty('events-pulse', 'circle-color', ['case', ['==', ['get', 'isFratEvent'], 1], fratColor, '#00D4FF']);
          }
          if (hasEventGlow) {
            map.setPaintProperty('events-glow', 'circle-color', ['case', ['==', ['get', 'isFratEvent'], 1], fratColor, '#00D4FF']);
          }
        }
      }

      // ── Route particle — runs at full 60fps for smooth movement ──
      const rCoords = routeCoordsRef.current;
      if (rCoords && rCoords.length > 1) {
        const particleT = (now % 4000) / 4000;
        const totalSegments = rCoords.length - 1;
        const exactIdx = particleT * totalSegments;
        const idx = Math.floor(exactIdx);
        const frac = exactIdx - idx;
        const nextIdx = Math.min(idx + 1, totalSegments);

        // Linear interpolation between coordinate points → smooth glide
        const lng = rCoords[idx][0] + (rCoords[nextIdx][0] - rCoords[idx][0]) * frac;
        const lat = rCoords[idx][1] + (rCoords[nextIdx][1] - rCoords[idx][1]) * frac;

        const pSrc = map.getSource('route-particle') as mapboxgl.GeoJSONSource | undefined;
        if (pSrc) {
          pSrc.setData({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: {},
          });
        }
      }

      // ── Activity particles — realistic people walking along streets ──
      // Only at zoom > 12, only when cached routes exist, hard cap 25
      if (now - lastPaintFrame < 5) { // piggyback on 30fps gate
        const zoom = map.getZoom();
        const pSrcAct = map.getSource('activity-particles') as mapboxgl.GeoJSONSource | undefined;
        const cache = routeCacheRef.current;
        if (pSrcAct && zoom > 12 && cache && cache.routes.length > 0) {
          if (now % 60000 < 33) nightPhaseRef.current = getNightPhase();
          const phase = nightPhaseRef.current;
          const targetCount = Math.min(phase.particleCount, 25);

          const particles = particlesRef.current;
          while (particles.length < targetCount) {
            const p = spawnParticle(cache, phase);
            if (p) particles.push(p);
            else break;
          }
          while (particles.length > targetCount) particles.pop();

          const positions: [number, number][] = [];
          const colors: string[] = [];
          for (let i = particles.length - 1; i >= 0; i--) {
            const result = tickParticle(particles[i], now);
            if (result.done) {
              const p = spawnParticle(cache, phase);
              if (p) particles[i] = p;
              else particles.splice(i, 1);
            } else {
              positions.push(result.pos);
              colors.push(result.color);
            }
          }

          if (positions.length > 0) {
            pSrcAct.setData(particlesToGeoJSON(positions, colors));
          } else {
            pSrcAct.setData({ type: 'FeatureCollection', features: [] });
          }
        } else if (pSrcAct) {
          // No routes or zoomed out — clear particles
          if (particlesRef.current.length > 0) {
            particlesRef.current = [];
            pSrcAct.setData({ type: 'FeatureCollection', features: [] });
          }
        }
      }

      lastFrameTime = performance.now() - now;
      animFrameRef.current = requestAnimationFrame(animate);
    }

    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [mapLoaded]);

  // ── Event layer click handler ──
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const map = mapRef.current;

    const handleEventLayerClick = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const eventId = feature.properties?.id as string | undefined;
      if (!eventId) return;
      const evt = eventsRef.current?.find(ev => ev.id === eventId);
      if (evt) {
        e.originalEvent.stopPropagation();
        onEventClickRef.current?.(evt);
      }
    };

    map.on('click', 'events-core', handleEventLayerClick);
    map.on('click', 'events-ring', handleEventLayerClick);

    const setCursor = () => { map.getCanvas().style.cursor = 'pointer'; };
    const resetCursor = () => { map.getCanvas().style.cursor = ''; };
    map.on('mouseenter', 'events-core', setCursor);
    map.on('mouseleave', 'events-core', resetCursor);

    return () => {
      map.off('click', 'events-core', handleEventLayerClick);
      map.off('click', 'events-ring', handleEventLayerClick);
      map.off('mouseenter', 'events-core', setCursor);
      map.off('mouseleave', 'events-core', resetCursor);
    };
  }, [mapLoaded]);

  if (!mapboxReady) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#050507]">
        <p className="text-[#8A8A95] text-sm" style={{ fontFamily: 'Satoshi, sans-serif' }}>
          Map requires VITE_MAPBOX_TOKEN in .env
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-full" style={{ position: 'relative' }}>
      <div ref={mapContainer} className="w-full h-full" />

      {/* Phase 4 market UX overlays — flag-gated. Pulse line self-hides
          when there's no confident data. MoversChip floats bottom-left
          when there are movers; tapping it morphs into MarketPanel via
          a shared layoutId, replacing the old bottom-sheet drawer. */}
      {FEATURE_FLAGS.MARKET_UX && (
        <>
          <div className="map-pulse-line-wrapper">
            <CityPulseLine city={city} />
            <MarketTicker
              city={city}
              onVenueTap={(venue) => {
                mapRef.current?.flyTo({
                  center: [venue.lng, venue.lat],
                  zoom: 16,
                  duration: 1100,
                  essential: true,
                });
                setSpotlightVenueId(venue.venue_id);
              }}
            />
          </div>
          <MoversChip
            city={city}
            onOpen={() => setMarketViewActive(true)}
            hidden={marketViewActive}
          />
          <MarketPanel
            city={city}
            active={marketViewActive}
            onClose={exitMarketView}
            onVenueTap={(venueId, venue) => {
              setSpotlightVenueId(venueId);
              mapRef.current?.flyTo({
                center: [venue.lng, venue.lat],
                zoom: 16,
                duration: 1100,
                essential: true,
              });
            }}
            spotlightVenueId={spotlightVenueId}
          />
        </>
      )}

      {/* Walking navigation overlays */}
      {route && routeDuration != null && routeDistance != null && (
        <>
          {/* Walking time pill (top) */}
          <div className="route-pill-enter" style={{
            position: 'absolute',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 500,
            background: routeArrived ? '#00FF88' : '#1C1C2E',
            borderLeft: routeArrived ? '3px solid #00FF88' : '3px solid #FF8200',
            borderRadius: '12px',
            padding: routeArrived ? '10px 20px' : '8px 16px',
            minWidth: '140px',
            textAlign: 'center',
            boxShadow: routeArrived ? '0 4px 24px rgba(0, 255, 136, 0.3)' : '0 4px 20px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
            transition: 'background 0.3s, box-shadow 0.3s, border-left 0.3s',
          }}>
            {routeArrived ? (
              <p style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '15px', fontWeight: 800, color: '#050507', margin: 0 }}>
                {'\uD83C\uDF89'} You made it to {routeDestination}!
              </p>
            ) : (
              <>
                <p style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '14px', fontWeight: 700, color: 'white', margin: 0 }}>
                  {'\uD83D\uDEB6'} {formatWalkDuration(routeDuration)} walk
                </p>
                <p style={{ fontFamily: 'Satoshi, sans-serif', fontSize: '12px', color: '#8A8A95', margin: '2px 0 0' }}>
                  {formatWalkDistance(routeDistance)}{routeDestination ? ` to ${routeDestination}` : ''}
                </p>
              </>
            )}
          </div>

          {/* Cancel bar (bottom) — hidden on arrival since it auto-dismisses */}
          {!routeArrived && <div className="route-cancel-enter" style={{
            position: 'absolute',
            bottom: '8px',
            left: '12px',
            right: '12px',
            zIndex: 500,
          }}>
            <button
              onClick={onCancelRoute}
              className="active:scale-[0.98] transition-transform"
              style={{
                width: '100%',
                height: '44px',
                borderRadius: '12px',
                background: '#1C1C2E',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'white',
                fontSize: '14px',
                fontWeight: 600,
                fontFamily: 'Satoshi, sans-serif',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {'\u2715'} End Navigation
            </button>
          </div>}
        </>
      )}

      {/* Heat field — atmospheric Mapbox layers beneath the bubbles.
          Renders nothing visible itself; just controls 2 Mapbox layers. */}
      {mapRef.current && mapLoaded && (
        <HeatFieldLayer
          map={mapRef.current}
          mapLoaded={mapLoaded}
          geojson={heatGeojson}
          mode={isNightHours() ? 'night' : 'day'}
          selectedVenueId={selectedVenueId ?? null}
        />
      )}

      {/* Phase D.5 — street-zoom WebGL mural. Fades in at zoom 14,
          full at 14.5+. HeatFieldLayer fades out at zoom 13.5 so the
          two never paint the same band. */}
      {mapRef.current && mapLoaded && (
        <VibeCanvasLayer
          map={mapRef.current}
          mapLoaded={mapLoaded}
          points={canvasPoints}
        />
      )}

      {/* Live events feed — toasts at top of map for surge / rapid-rise / social-pulse */}
      <LiveEventsFeed
        currentCity={city}
        onEventTap={(venueId) => {
          const v = venuesRef.current.find(x => x.id === venueId);
          if (v && mapRef.current) {
            mapRef.current.flyTo({
              center: [v.lng, v.lat],
              zoom: 16,
              duration: 1200,
              curve: 1.4,
              essential: true,
            });
          }
        }}
      />

      {/* Globe-view stats overlay — top center, only at low zoom */}
      {isAtGlobe && (
        <div className="globe-stats-overlay">
          <div className="globe-stats-counter">
            {(totalPeopleOut ?? 0).toLocaleString()} out tonight
          </div>
          <div className="globe-stats-subtitle">
            across {cityAggregates?.length ?? 0} {(cityAggregates?.length ?? 0) === 1 ? 'city' : 'cities'}
          </div>
        </div>
      )}

      {/* Share-globe button — only visible at globe zoom; sits ABOVE the
          globe icon. Animated entry uses share-btn-fade-in (in index.css). */}
      {isAtGlobe && onShareGlobe && (
        <button
          type="button"
          onClick={onShareGlobe}
          disabled={sharingGlobe}
          aria-label="Share globe view"
          className="map-side-pill active:scale-[0.95] transition-transform"
          style={{
            position: 'absolute',
            bottom: route ? '300px' : '240px',
            right: '16px',
            zIndex: 500,
            width: 48,
            height: 48,
            borderRadius: 24,
            background: 'rgba(28, 28, 46, 0.92)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: sharingGlobe ? 'wait' : 'pointer',
            opacity: sharingGlobe ? 0.6 : 1,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
            WebkitTapHighlightColor: 'transparent',
            animation: 'share-btn-fade-in 400ms ease-out',
            ...sidePillSheetStyle,
          }}
        >
          {sharingGlobe ? (
            <span className="share-spinner" aria-hidden />
          ) : (
            <Share2 size={22} strokeWidth={1.75} color="rgba(255, 255, 255, 0.85)" />
          )}
        </button>
      )}

      {/* Globe icon button — flies camera up to globe view */}
      <button
        type="button"
        onClick={() => {
          const m = mapRef.current;
          if (!m) return;
          m.flyTo({
            center: m.getCenter(),
            zoom: 0.8,
            pitch: 0,
            bearing: 0,
            duration: 2400,
            curve: 1.42,
            essential: true,
          });
        }}
        aria-label="View globe"
        className="map-side-pill active:scale-[0.95] transition-transform"
        style={{
          position: 'absolute',
          bottom: route ? '240px' : '180px',
          right: '16px',
          zIndex: 500,
          width: '48px',
          height: '48px',
          borderRadius: '24px',
          background: 'rgba(28, 28, 46, 0.92)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
          WebkitTapHighlightColor: 'transparent',
          ...sidePillSheetStyle,
        }}
      >
        <Globe
          size={22}
          strokeWidth={1.75}
          color={isAtGlobe ? '#FF8200' : 'rgba(255, 255, 255, 0.85)'}
        />
      </button>

      {/* Follow-me button — always visible when location is available */}
      {userLocation && onToggleFollow && (
        <button
          onClick={onToggleFollow}
          className="map-side-pill active:scale-[0.95] transition-transform"
          style={{
            position: 'absolute',
            bottom: route ? '180px' : '120px',
            right: '16px',
            zIndex: 500,
            width: '48px',
            height: '48px',
            borderRadius: '24px',
            background: '#1C1C2E',
            border: followMode === 'free' ? '1px solid #333' : '1px solid #FF8200',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
            WebkitTapHighlightColor: 'transparent',
            ...sidePillSheetStyle,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={followMode === 'free' ? '#8A8A95' : '#FF8200'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {followMode === 'bearing' ? (
              // Compass arrow for bearing mode
              <><polygon points="12 2 19 21 12 17 5 21" fill="#FF8200" stroke="#FF8200" /></>
            ) : (
              // Crosshair for free/center mode
              <>
                <circle cx="12" cy="12" r="4" fill={followMode === 'center' ? '#FF8200' : 'none'} />
                <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
                <line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
              </>
            )}
          </svg>
        </button>
      )}
    </div>
  );
}
