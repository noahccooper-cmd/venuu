import { useState, useCallback, useRef, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { hapticLight, hapticMedium, hapticSuccess } from '../lib/haptics';
import { MapView } from '../components/Map/MapView';
import { VenueSheet } from '../components/Map/VenueCard';
import { EventCard } from '../components/Map/EventCard';
import { TheDrop } from '../components/Map/TheDrop';
import { getWalkingRoute, sliceRouteAhead, haversineMeters, distanceToRoute } from '../lib/directions';
import { mapboxToken } from '../lib/supabase';
import { CITIES } from '../lib/constants';
import { CoverPurchaseSheet } from '../components/Map/CoverPurchaseSheet';
import { useCityAggregates } from '../hooks/useCityAggregates';
import type { ColdOpenPhase } from '../hooks/useColdOpen';
import type { Map as MapboxMap } from 'mapbox-gl';
import type { Venue, Headcount, VenueEvent } from '../lib/types';
import type { CityKey } from '../lib/constants';
import type { Plan as VennyPlan } from '../components/Venny/PlanCard';
import type { CoverPriceInfo } from '../hooks/useCoverPricing';
import type { PurchaseResult } from '../hooks/useCoverPurchase';

interface ActiveRoute {
  fullGeometry: GeoJSON.LineString;  // Original full route
  geometry: GeoJSON.LineString;       // Current visible route (sliced as user walks)
  duration: number;
  distance: number;
  destinationName: string;
  destinationLng: number;
  destinationLat: number;
  arrived: boolean;
}

interface UserLocationPoint {
  lng: number;
  lat: number;
  accuracy: number;
}

interface TonightPageProps {
  city: CityKey;
  venues: Venue[];
  counts: Record<string, number>;
  headcounts: Record<string, Headcount>;
  liveVenueIds: Set<string>;
  pulsedVenueId: string | null;
  events: VenueEvent[];
  coverPrices?: Map<string, CoverPriceInfo>;
  userLocation?: UserLocationPoint | null;
  username: string;
  userId: string | null;
  onSignIn: () => void;
  onCityChange?: (city: CityKey) => void;
  purchasing?: boolean;
  myPurchases?: Map<string, { qr_code: string }>;
  onBuyCover?: (configId: string, venueId: string) => Promise<PurchaseResult>;
  onAskVenny?: (venue: Venue, headcount: Headcount | null) => void;
  /** Cold-open intro is currently playing — forwarded to MapView. */
  introActive?: boolean;
  /** Active intro phase, drives bubble-bloom staggering. */
  introPhase?: ColdOpenPhase;
  /** Captures the underlying mapboxgl.Map instance for the intro overlay. */
  onMapReady?: (map: MapboxMap) => void;
  /** Globe-view share button click handler (driven by useShareGlobe). */
  onShareGlobe?: () => void;
  /** True while a share is mid-flight. */
  sharingGlobe?: boolean;
  /** Venue IDs Venny has highlighted via highlight_on_map. Forwarded to MapView. */
  highlightedVenueIds?: string[];
  /** Active multi-stop plan composed by Venny — forwarded to MapView
   *  so the route line + numbered markers render. */
  activePlan?: VennyPlan | null;
  /** Called when a numbered route marker is tapped. */
  onPlanStopTap?: (stopIndex: number) => void;
  /** Index of the stop the PlanSheet currently has focused. Forwarded
   *  to MapView so the matching marker gets a one-shot pulse. */
  focusedStopIndex?: number | null;
  /** Plan sheet state — drives map camera padding so the focused
   *  stop stays visible above the sheet. */
  sheetState?: 'pill' | 'card' | 'full' | null;
}

export function TonightPage({
  city,
  venues,
  counts,
  headcounts,
  liveVenueIds,
  pulsedVenueId,
  events,
  coverPrices,
  userLocation,
  username,
  userId,
  onSignIn,
  onCityChange,
  purchasing,
  myPurchases,
  onBuyCover,
  onAskVenny,
  introActive,
  introPhase,
  onMapReady,
  onShareGlobe,
  sharingGlobe,
  highlightedVenueIds,
  activePlan,
  onPlanStopTap,
  focusedStopIndex,
  sheetState,
}: TonightPageProps) {
  // City rollups for the globe-view dot layer + headline counter.
  const { aggregates: cityAggregates, totalPeopleOut } = useCityAggregates();

  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const [coverVenue, setCoverVenue] = useState<{ id: string; name: string } | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<VenueEvent | null>(null);
  // `venueFilter` is kept locked to 'all' now that the filter row is
  // gone — left in place so MapView's filter logic keeps a stable
  // contract; future Venny tools can drive this if we re-introduce
  // server-side narrowing.
  const [venueFilter] = useState<'all' | 'bars' | 'greek'>('all');

  // Hide TheDrop + the venue-filter pill row at globe zoom — we're in
  // the universe view, the metro UI doesn't belong there. Mirrors the
  // isAtGlobe state inside MapView (kept local rather than lifted, to
  // avoid plumbing through another callback). The map instance attaches
  // to `mapInstanceRef.current` asynchronously inside MapView's load
  // handler, so we poll with rAF until it's available, then bind.
  const [isAtGlobe, setIsAtGlobe] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    type ZoomMap = { getZoom: () => number; on: (e: string, fn: () => void) => void; off: (e: string, fn: () => void) => void };
    let attached: ZoomMap | null = null;
    let handler: (() => void) | null = null;

    const tryAttach = () => {
      if (cancelled) return;
      const map = mapInstanceRef.current as ZoomMap | null;
      if (!map) {
        rafId = requestAnimationFrame(tryAttach);
        return;
      }
      attached = map;
      handler = () => setIsAtGlobe(map.getZoom() < 5);
      handler();
      map.on('zoom', handler);
    };
    tryAttach();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (attached && handler) attached.off('zoom', handler);
    };
  }, []);

  // Broadcast globe state so body-level pills mounted in other trees
  // (VennyBar in App, MarketTicker + MoversChip in MapView) can hide in
  // unison at globe zoom. TonightPage's isAtGlobe is the single source.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('venuu:globe-state', { detail: { isAtGlobe } }));
  }, [isAtGlobe]);

  const [activeRoute, setActiveRoute] = useState<ActiveRoute | null>(null);
  const [getThereLoading, setGetThereLoading] = useState(false);
  type FollowMode = 'free' | 'center' | 'bearing';
  const [followMode, setFollowMode] = useState<FollowMode>('free');
  const mapInstanceRef = useRef<any>(null);

  // Keep selectedVenue in sync with venues array (for realtime special updates)
  const currentVenue = selectedVenue
    ? venues.find(v => v.id === selectedVenue.id) ?? selectedVenue
    : null;

  const handleVenueClick = useCallback((venue: Venue) => {
    venue.category === 'fraternity' ? hapticMedium() : hapticLight();
    setSelectedVenue(venue);
    setSelectedEvent(null);
    if (mapInstanceRef.current) {
      const map = mapInstanceRef.current;
      const bounds = map.getBounds();
      if (!bounds) return;
      const latSpan = bounds.getNorth() - bounds.getSouth();
      const offsetLat = venue.lat - latSpan * 0.12;
      map.flyTo({
        center: [venue.lng, offsetLat],
        zoom: Math.max(map.getZoom(), 14.5),
        duration: 400,
        essential: true,
      });
    }
  }, []);

  const handleEventClick = useCallback((event: VenueEvent) => {
    hapticMedium();
    setSelectedEvent(event);
    setSelectedVenue(null);
    if (mapInstanceRef.current) {
      const map = mapInstanceRef.current;
      let lng = event.longitude;
      let lat = event.latitude;
      if (event.venue_id) {
        const v = venues.find(ven => ven.id === event.venue_id);
        if (v) { lng = v.lng; lat = v.lat; }
      }
      const bounds = map.getBounds();
      if (!bounds) return;
      const latSpan = bounds.getNorth() - bounds.getSouth();
      const offsetLat = lat - latSpan * 0.12;
      map.flyTo({
        center: [lng, offsetLat],
        zoom: Math.max(map.getZoom(), 14.5),
        duration: 400,
        essential: true,
      });
    }
  }, [venues]);

  const handleClose = useCallback(() => {
    setSelectedVenue(null);
  }, []);

  const handleEventClose = useCallback(() => {
    setSelectedEvent(null);
  }, []);

  const handleMapTap = useCallback(() => {
    if (selectedVenue) setSelectedVenue(null);
    if (selectedEvent) setSelectedEvent(null);
  }, [selectedVenue, selectedEvent]);

  const handleFlyTo = useCallback((lng: number, lat: number) => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo({
        center: [lng, lat],
        zoom: Math.max(mapInstanceRef.current.getZoom(), 15),
        duration: 600,
        essential: true,
      });
    }
  }, []);

  // ── "Get There" walking navigation ──
  const recalcTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleGetThere = useCallback(async (venue: Venue) => {
    if (getThereLoading) return;
    setGetThereLoading(true);
    console.debug('[nav] Get There tapped for', venue.name);

    try {
      // 1. Get user location — try existing userLocation first, fall back to one-shot
      let from: [number, number];
      if (userLocation) {
        from = [userLocation.lng, userLocation.lat];
        console.debug('[nav] Using tracked location:', from);
      } else {
        console.debug('[nav] No tracked location, requesting one-shot...');
        // Check permission first on native
        if (Capacitor.isNativePlatform()) {
          const perm = await Geolocation.checkPermissions();
          if (perm.location === 'denied') {
            const req = await Geolocation.requestPermissions();
            if (req.location === 'denied') {
              console.debug('[nav] Location permission denied');
              setGetThereLoading(false);
              return;
            }
          }
          const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
          from = [pos.coords.longitude, pos.coords.latitude];
        } else {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
          });
          from = [pos.coords.longitude, pos.coords.latitude];
        }
        console.debug('[nav] Got one-shot location:', from);
      }

      // 2. Fetch walking route
      const to: [number, number] = [venue.lng, venue.lat];
      console.debug('[nav] Fetching route from', from, 'to', to);
      const result = await getWalkingRoute(from, to, mapboxToken, venue.id);
      if (!result) {
        console.warn('[nav] Mapbox Directions returned no route');
        setGetThereLoading(false);
        return;
      }
      console.debug('[nav] Route received:', Math.round(result.duration) + 's,', Math.round(result.distance) + 'm');

      // 3. Set route state FIRST, then close venue card
      hapticSuccess();
      setActiveRoute({
        fullGeometry: result.geometry,
        geometry: result.geometry,
        duration: result.duration,
        distance: result.distance,
        destinationName: venue.name,
        destinationLng: venue.lng,
        destinationLat: venue.lat,
        arrived: false,
      });
      setFollowMode('center');

      // Small delay so route renders before card dismisses
      setTimeout(() => {
        setSelectedVenue(null);
        setGetThereLoading(false);
      }, 100);
    } catch (err) {
      console.warn('[nav] Get There failed:', err);
      setGetThereLoading(false);
    }
  }, [getThereLoading, userLocation]);

  const handleCancelRoute = useCallback(() => {
    setActiveRoute(null);
    setFollowMode('free');
    if (recalcTimerRef.current) { clearInterval(recalcTimerRef.current); recalcTimerRef.current = null; }
    if (mapInstanceRef.current) {
      const config = CITIES[city];
      mapInstanceRef.current.easeTo({
        center: [config.center.lng, config.center.lat],
        zoom: config.zoom,
        bearing: 0,
        pitch: 0,
        duration: 800,
      });
    }
  }, [city]);

  // Follow-me mode handler
  const handleToggleFollow = useCallback(() => {
    hapticLight();
    setFollowMode(prev => {
      if (prev === 'free') return 'center';
      if (prev === 'center') return 'bearing';
      return 'free';
    });
  }, []);

  // ── Live route updates: recalc every 30s + reroute on deviation + arrival detection ──
  useEffect(() => {
    if (!activeRoute || activeRoute.arrived || !userLocation) return;

    const userPos: [number, number] = [userLocation.lng, userLocation.lat];
    const destPos: [number, number] = [activeRoute.destinationLng, activeRoute.destinationLat];

    // Check arrival (within 50m of destination)
    const distToDest = haversineMeters(userPos, destPos);
    if (distToDest < 50) {
      setActiveRoute(prev => prev ? { ...prev, arrived: true, duration: 0, distance: distToDest } : null);
      // Auto-dismiss after 3 seconds
      setTimeout(() => {
        setActiveRoute(null);
        if (recalcTimerRef.current) { clearInterval(recalcTimerRef.current); recalcTimerRef.current = null; }
      }, 3000);
      return;
    }

    // Slice route ahead of user (shrinking line effect)
    const sliced = sliceRouteAhead(activeRoute.fullGeometry, userPos);
    setActiveRoute(prev => {
      if (!prev || prev.arrived) return prev;
      return { ...prev, geometry: sliced };
    });

    // Check if user deviated >50m from route — trigger immediate recalc
    const deviation = distanceToRoute(
      activeRoute.fullGeometry.coordinates as [number, number][],
      userPos,
    );
    if (deviation > 50) {
      getWalkingRoute(userPos, destPos, mapboxToken).then(result => {
        if (!result) return;
        setActiveRoute(prev => {
          if (!prev || prev.arrived) return prev;
          return { ...prev, fullGeometry: result.geometry, geometry: result.geometry, duration: result.duration, distance: result.distance };
        });
      });
    }
  }, [userLocation, activeRoute?.arrived, activeRoute?.destinationLng, activeRoute?.destinationLat, activeRoute?.fullGeometry]);

  // 30-second periodic recalculation
  useEffect(() => {
    if (!activeRoute || activeRoute.arrived) {
      if (recalcTimerRef.current) { clearInterval(recalcTimerRef.current); recalcTimerRef.current = null; }
      return;
    }

    recalcTimerRef.current = setInterval(() => {
      if (!userLocation) return;
      const userPos: [number, number] = [userLocation.lng, userLocation.lat];
      const destPos: [number, number] = [activeRoute.destinationLng, activeRoute.destinationLat];
      getWalkingRoute(userPos, destPos, mapboxToken).then(result => {
        if (!result) return;
        setActiveRoute(prev => {
          if (!prev || prev.arrived) return prev;
          return { ...prev, fullGeometry: result.geometry, geometry: sliceRouteAhead(result.geometry, userPos), duration: result.duration, distance: result.distance };
        });
      });
    }, 30000);

    return () => {
      if (recalcTimerRef.current) { clearInterval(recalcTimerRef.current); recalcTimerRef.current = null; }
    };
  }, [activeRoute?.arrived, activeRoute?.destinationLng, activeRoute?.destinationLat, userLocation]);

  return (
    <div className="absolute inset-0" style={{ top: 'calc(80px + env(safe-area-inset-top, 0px))', bottom: '60px' }}>
      {!activeRoute && (
        <div
          style={{
            opacity: isAtGlobe ? 0 : 1,
            pointerEvents: isAtGlobe ? 'none' : 'auto',
            transition: 'opacity 320ms ease-out',
          }}
        >
          <TheDrop venues={venues} events={events} onFlyTo={handleFlyTo} onEventTap={handleEventClick} />
        </div>
      )}

      {/* Venue-type filter row removed — replaced by VennyBar (rendered
       *  one level up in App.tsx). The `venueFilter` state below stays
       *  on 'all' for now but remains in place in case a future Venny
       *  tool needs to narrow the visible markers programmatically. */}

      <MapView
        city={city}
        venues={venues}
        venueFilter={venueFilter}
        counts={counts}
        liveVenueIds={liveVenueIds}
        pulsedVenueId={pulsedVenueId}
        events={events}
        coverPrices={coverPrices}
        userLocation={userLocation}
        route={activeRoute?.geometry ?? null}
        routeDuration={activeRoute?.duration ?? null}
        routeDistance={activeRoute?.distance ?? null}
        routeDestination={activeRoute?.destinationName ?? null}
        routeArrived={activeRoute?.arrived ?? false}
        followMode={followMode}
        onVenueClick={handleVenueClick}
        onEventClick={handleEventClick}
        onMapTap={handleMapTap}
        onCityChange={onCityChange}
        onCityTapFromGlobe={onCityChange}
        cityAggregates={cityAggregates}
        totalPeopleOut={totalPeopleOut}
        introActive={introActive}
        introPhase={introPhase}
        onMapReady={onMapReady}
        onShareGlobe={onShareGlobe}
        sharingGlobe={sharingGlobe}
        onCancelRoute={handleCancelRoute}
        onPriceTap={(id, name) => { console.debug('[covers] Price tap:', name); setSelectedVenue(null); setSelectedEvent(null); setCoverVenue({ id, name }); }}
        onToggleFollow={handleToggleFollow}
        onUserDragMap={() => setFollowMode('free')}
        mapInstanceRef={mapInstanceRef}
        highlightedVenueIds={highlightedVenueIds}
        activePlan={activePlan}
        onPlanStopTap={onPlanStopTap}
        focusedStopIndex={focusedStopIndex ?? null}
        sheetState={sheetState ?? null}
        selectedVenueId={selectedVenue?.id ?? null}
      />

      {currentVenue && (
        <VenueSheet
          venue={currentVenue}
          headcount={headcounts[currentVenue.id] ?? null}
          venueEvent={events.find(e => e.venue_id === currentVenue.id && e.is_active) ?? null}
          username={username}
          userId={userId}
          onSignIn={onSignIn}
          onClose={handleClose}
          onGetThere={() => handleGetThere(currentVenue)}
          getThereLoading={getThereLoading}
          onAskVenny={onAskVenny ? () => onAskVenny(currentVenue, headcounts[currentVenue.id] ?? null) : undefined}
          coverPriceInfo={coverPrices?.get(currentVenue.id) ?? null}
          onBuyCover={coverPrices?.has(currentVenue.id) && onBuyCover
            ? () => { setSelectedVenue(null); setCoverVenue({ id: currentVenue.id, name: currentVenue.name }); }
            : undefined}
        />
      )}

      {selectedEvent && (
        <EventCard
          event={selectedEvent}
          userId={userId}
          venueName={selectedEvent.venue_id ? venues.find(v => v.id === selectedEvent.venue_id)?.name ?? null : null}
          onSignIn={onSignIn}
          onClose={handleEventClose}
        />
      )}

      {coverVenue && coverPrices?.get(coverVenue.id) && onBuyCover && (
        <CoverPurchaseSheet
          venueId={coverVenue.id}
          venueName={coverVenue.name}
          priceInfo={coverPrices.get(coverVenue.id)!}
          alreadyPurchasedQR={myPurchases?.get(coverVenue.id)?.qr_code ?? null}
          purchasing={purchasing ?? false}
          onBuy={onBuyCover}
          onClose={() => setCoverVenue(null)}
        />
      )}
    </div>
  );
}
