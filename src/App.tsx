import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { AnimatePresence } from 'framer-motion';
import type { Map as MapboxMap } from 'mapbox-gl';
import { envReady } from './lib/supabase';
import { useCity } from './hooks/useCity';
import { useVenues } from './hooks/useVenues';
import { useHeadcounts } from './hooks/useHeadcounts';
import { useAuth } from './hooks/useAuth';
import { useColdOpen } from './hooks/useColdOpen';
import { useCityAggregates } from './hooks/useCityAggregates';
import { useShareGlobe } from './hooks/useShareGlobe';
import { CinematicIntro } from './components/Intro/CinematicIntro';
import { Header } from './components/Layout/Header';
import { BottomNav, type Tab } from './components/Layout/BottomNav';
import { TonightPage } from './pages/TonightPage';
import { CommunityPage } from './pages/CommunityPage';
import { PortalPage } from './pages/PortalPage';
import { PublicProfilePage } from './pages/PublicProfilePage';
import { VennyBar } from './components/Venny/VennyBar';
import { EventsToggle } from './components/EventsMode/EventsToggle';
import { EventScrubber } from './components/EventsMode/EventScrubber';
import { buildWindows, type EventWindow, type WindowChip } from './lib/eventWindows';
import { EventLineupSheet, type SheetSnap } from './components/EventsMode/EventLineupSheet';
import { HostHubCard } from './components/EventsMode/HostHubCard';
import { VenueToast } from './components/EventsMode/VenueToast';
import type { LineupEvent } from './hooks/useEventsLineup';
import { getDefaultMapMode, broadcastMapMode, type MapMode } from './lib/mapMode';
import { VennySheet } from './components/Venny/VennySheet';
import { SignInSheet } from './components/Auth/SignInSheet';
import { NicknameScreen } from './components/Auth/NicknameScreen';
import { ProfileOverlay } from './components/Profile/ProfileOverlay';
import { ProfileScreen } from './components/Profile/ProfileScreen';
import { OnboardingScreen } from './components/Onboarding/OnboardingScreen';
import { TasteFlow } from './components/Onboarding/TasteFlow';
import { PushBanner } from './components/Notifications/PushBanner';
import { usePushNotifications, markPushListenerReady } from './hooks/usePushNotifications';
import { useEvents } from './hooks/useEvents';
import { useUserLocation } from './hooks/useUserLocation';
import { useProximityDetection } from './hooks/useProximityDetection';
import { useCoverPricing } from './hooks/useCoverPricing';
import { useCoverPurchase } from './hooks/useCoverPurchase';
import {
  LocationPermissionCard,
  hasDismissedLocationPrompt,
  markLocationPromptDismissed,
} from './components/Location/LocationPermissionCard';
import type { Venue, Headcount, VenueEvent } from './lib/types';

/** /u/{16-hex-token} route detection — returns the token if the
 *  current URL matches, else null. Run BEFORE any other state setup
 *  so the public-profile page can short-circuit the full app shell
 *  and render as a standalone marketing surface. */
const PUBLIC_PROFILE_RE = /^\/u\/([a-z0-9]{16})\/?$/i;
function getPublicProfileToken(): string | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(PUBLIC_PROFILE_RE);
  return m ? m[1] : null;
}

export default function App() {
  // Capture once — reading window.location.pathname during render is
  // safe, but we don't want this to be reactive to client-side nav
  // (we don't have a router, so there's none to react to anyway).
  const [publicShareToken] = useState<string | null>(getPublicProfileToken);

  const [tab, setTab] = useState<Tab>('tonight');
  // Venue-staff tools (Clicker/Security/Admin/Frat portals) — reached
  // via a discreet entry point in ProfileScreen, not the consumer nav.
  const [portalOpen, setPortalOpen] = useState(false);
  const [focusedVenue, setFocusedVenue] = useState<{ venue: Venue; headcount: Headcount | null } | null>(null);
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem('venuu_onboarded') === 'true');
  const [showSignIn, setShowSignIn] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  // ── Venny v1.2.1 — optional priming message ──────────────────────
  // When the profile's "Tell Venny your taste" banner is tapped, we
  // open the sheet with a message ready to auto-send so Venny starts
  // the taste-capture conversation in one tap.
  const [vennyInitialMessage, setVennyInitialMessage] = useState<string | null>(null);
  // Tinder-style taste calibration flow — full-screen modal opened
  // from the profile's "Quick setup" CTA (Session B). Independent of
  // VennySheet so the user can finish/skip without involving Venny.
  const [tasteFlowOpen, setTasteFlowOpen] = useState(false);
  // ── Venny v1.1 ──
  const [vennyOpen, setVennyOpen] = useState(false);
  const [highlightedVenueIds, setHighlightedVenueIds] = useState<string[]>([]);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { city, switchCity } = useCity();

  // ── Map mode — VIBE (default) or EVENTS (calendar discovery) ──
  // Smart default on mount: events mode on Fri/Sat or any night >8pm,
  // otherwise vibe. User can flip via the EventsToggle at bottom-center.
  const [mapMode, setMapMode] = useState<MapMode>(() => getDefaultMapMode());

  // Broadcast mode changes so body-level pills (VennyBar, TheDrop,
  // stock market) can react via the venuu:map-mode event bus.
  useEffect(() => {
    broadcastMapMode(mapMode);
  }, [mapMode]);

  // ── Event lineup sheet — pill / mid / full snap, plus glowing card ──
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('pill');
  const [glowingEventId, setGlowingEventId] = useState<string | null>(null);
  const [, setActiveEvent] = useState<LineupEvent | null>(null);

  // ── Active hub for the HostHubCard (events mode only) ──
  const [activeHubId, setActiveHubId] = useState<string | null>(null);

  // ── Events-mode time scrubber selection ──
  const [scrubberWindow, setScrubberWindow] = useState<EventWindow>('tonight');
  const [scrubberChipId, setScrubberChipId] = useState<string>('');

  // Close hub card when user exits events mode
  useEffect(() => {
    if (mapMode !== 'events') setActiveHubId(null);
  }, [mapMode]);

  // Events mode opens at PILL snap — user taps pill to expand
  // Map remains the hero; pill is the entry point to the lineup
  useEffect(() => {
    if (mapMode === 'events') {
      setSheetSnap('pill');
    } else {
      setSheetSnap('pill');
      setGlowingEventId(null);
    }
  }, [mapMode]);

  // Clear the glow after 1.8s
  useEffect(() => {
    if (!glowingEventId) return;
    const t = setTimeout(() => setGlowingEventId(null), 1800);
    return () => clearTimeout(t);
  }, [glowingEventId]);

  // Apply events-mode class to body for components rendered deep in the
  // tree (TheDrop, MarketTicker, CityPulseLine, MiniVennyPill) — they
  // fade themselves out via CSS in index.css rather than prop threading.
  useEffect(() => {
    if (mapMode === 'events') {
      document.body.classList.add('events-mode-active');
    } else {
      document.body.classList.remove('events-mode-active');
    }
    return () => document.body.classList.remove('events-mode-active');
  }, [mapMode]);

  const { user, profile, needsOnboard, signInWithApple, sendMagicLink, createProfile, signOut, refreshProfile } = useAuth();

  // Username source-of-truth: profile.username (from useAuth → DB) is the
  // canonical value. Legacy localStorage covers the brief window where the
  // profile is still loading; 'Guest' is the terminal fallback for truly
  // unauthenticated sessions. Previously this was inverted (localStorage
  // first, declared above useAuth, no profile lookup), so any user missing
  // a 'venue_username' key posted recaps as @Guest.
  const username = useMemo(
    () => profile?.username ?? localStorage.getItem('venue_username') ?? 'Guest',
    [profile?.username],
  );
  const { venues, error: venuesError, refetch: refetchVenues } = useVenues(city);
  const cityAggregatesData = useCityAggregates();
  const tonightMapRef = useRef<MapboxMap | null>(null);

  // Card tap → fly the map to the event's venue (or its raw coords) and
  // glow it. Mirrors the pin-tap direction so the two stay in sync.
  const flyMapToEvent = useCallback((evt: LineupEvent) => {
    setGlowingEventId(evt.id);
    const map = tonightMapRef.current;
    if (!map) return;
    let lng = evt.longitude;
    let lat = evt.latitude;
    if (evt.venue_id) {
      const v = venues.find(ven => ven.id === evt.venue_id);
      if (v) { lng = v.lng; lat = v.lat; }
    }
    const bounds = map.getBounds();
    const latSpan = bounds ? bounds.getNorth() - bounds.getSouth() : 0;
    map.flyTo({
      center: [lng, lat - latSpan * 0.12],
      zoom: Math.max(map.getZoom(), 14.5),
      duration: 500,
      essential: true,
    });
  }, [venues]);

  // ── Cinematic cold open ─────────────────────────────────────
  const targetCityName = useMemo(() => {
    switch (city) {
      case 'knoxville':     return 'Knoxville, TN';
      case 'tampa':         return 'Tampa, FL';
      case 'st_petersburg': return 'St. Petersburg, FL';
      default:              return city;
    }
  }, [city]);

  const coldOpenEnabled = (
    envReady &&
    onboarded &&
    venues.length > 0 &&
    cityAggregatesData.aggregates.length > 0
  );

  const coldOpen = useColdOpen({
    enabled: coldOpenEnabled,
    targetCity: city,
  });

  // Globe-share — captures the live map canvas, composites a venuu
  // overlay, logs to globe_snapshots, then routes through the native
  // share sheet. The hook reads tonightMapRef.current at click time.
  const shareGlobe = useShareGlobe({
    mapRef: tonightMapRef,
    aggregates: cityAggregatesData.aggregates,
    totalPeopleOut: cityAggregatesData.totalPeopleOut,
    userId: user?.id ?? null,
  });
  const { headcounts, pulsedVenueId } = useHeadcounts(city);
  const { events } = useEvents(city);

  // Seed the scrubber with a valid chip once windows are built — first
  // window (tonight → week → month → specials) that actually has a chip.
  const scrubberWindows = useMemo(() => buildWindows(events), [events]);
  useEffect(() => {
    if (scrubberChipId !== '') return;
    const first =
      scrubberWindows.tonight[0] ??
      scrubberWindows.week[0] ??
      scrubberWindows.month[0] ??
      scrubberWindows.specials[0];
    if (first) setScrubberChipId(first.id);
  }, [scrubberWindows]);

  // Venues lit by the currently selected scrubber chip — drives the
  // map's three-tier beacon sweep (lit / dormant / context dot).
  const litVenueIds = useMemo(() => {
    const chip = scrubberWindows[scrubberWindow]?.find(c => c.id === scrubberChipId);
    return chip ? new Set(chip.litVenueIds) : new Set<string>();
  }, [scrubberWindows, scrubberWindow, scrubberChipId]);

  // Selected chip's date range (epoch ms) — threaded to MapView for the
  // gold/blue temporal model. Null when no specific chip is selected
  // (entry / broad state) → MapView treats the whole window as in-range.
  const selectedRange = useMemo(() => {
    const chip = scrubberWindows[scrubberWindow]?.find(c => c.id === scrubberChipId);
    return chip ? { start: chip.rangeStart, end: chip.rangeEnd } : null;
  }, [scrubberWindows, scrubberWindow, scrubberChipId]);

  // ── Venue-name toast on pin tap ──────────────────────────────
  const [venueToast, setVenueToast] = useState<string | null>(null);
  useEffect(() => {
    if (!venueToast) return;
    const t = setTimeout(() => setVenueToast(null), 1800);
    return () => clearTimeout(t);
  }, [venueToast]);

  // ── Bidirectional bond — pin tap → glow card, expand sheet, toast ──
  // Map fly is handled in TonightPage's own pin handler; here we drive
  // the sheet + toast. Toast counts events sharing the tapped venue's
  // location (matches the lat/lng grouping key used for the pins).
  const handleEventPinClick = useCallback((evt: VenueEvent) => {
    setGlowingEventId(evt.id);

    let lng = evt.longitude;
    let lat = evt.latitude;
    let venueName = evt.host_name || 'Venue';
    let tappedVenue: Venue | undefined;
    if (evt.venue_id) {
      tappedVenue = venues.find(vn => vn.id === evt.venue_id);
      if (tappedVenue) { lng = tappedVenue.lng; lat = tappedVenue.lat; venueName = tappedVenue.name; }
    }

    // If the tapped venue is a hub, open the HostHubCard instead of
    // expanding the city lineup sheet.
    if (tappedVenue?.is_hub) {
      setActiveHubId(tappedVenue.id);
      return;
    }

    const lngKey = lng?.toFixed(4);
    const latKey = lat?.toFixed(4);
    const eventCount = events.filter(e => {
      let elng = e.longitude;
      let elat = e.latitude;
      if (e.venue_id) {
        const v = venues.find(vn => vn.id === e.venue_id);
        if (v) { elng = v.lng; elat = v.lat; }
      }
      return elng?.toFixed(4) === lngKey && elat?.toFixed(4) === latKey;
    }).length;

    setVenueToast(eventCount > 1
      ? `${venueName.toUpperCase()} · ${eventCount} EVENTS`
      : venueName.toUpperCase());

    setSheetSnap(prev => (prev === 'pill' ? 'mid' : prev));
  }, [venues, events]);

  // ── Foreground location ──
  const userLocationFull = useUserLocation({
    enabled: !!user && !coldOpen.active,
    pollIntervalMs: 60_000,
    highAccuracy: false,
  });
  const userLocation = userLocationFull.location;
  const { coverPrices } = useCoverPricing(city);
  const { purchasing, myPurchases, purchaseCover, fetchMyPurchases } = useCoverPurchase(user?.id ?? null);

  // ── Passive presence — credits user_visits when the user lingers
  //    inside a venue's geofence (60m enter, 100m exit hysteresis,
  //    20-min cooldown).
  useProximityDetection({
    userLat: userLocationFull.lat,
    userLng: userLocationFull.lng,
    userAccuracy: userLocationFull.accuracy,
    venues,
    enabled: !!profile?.id && !coldOpen.active,
    userId: profile?.id ?? null,
  });

  // Location permission prompt — show the floating card once per
  // dismiss-flag, when permission is anywhere short of a definitive
  // 'granted' or 'denied' answer. iOS sometimes returns 'granted'
  // immediately after reinstall and sometimes goes straight to
  // 'unknown' — both cases would have failed the old `=== 'prompt'`
  // gate. The card now surfaces broadly + only suppresses on the two
  // states we genuinely don't need to ask in.
  const [locationPromptDismissed, setLocationPromptDismissed] = useState(hasDismissedLocationPrompt);
  const showLocationPrompt =
    !!user
    && !coldOpen.active
    && tab === 'tonight'
    && userLocationFull.permissionStatus !== 'granted'
    && userLocationFull.permissionStatus !== 'denied'
    && !locationPromptDismissed;

  const handleAllowLocation = useCallback(async () => {
    // If the OS has already told us 'denied' there's nothing the JS
    // prompt can do — the user has to flip the toggle in iOS Settings
    // (or the browser's permission UI on web). Route to those.
    if (userLocationFull.permissionStatus === 'denied') {
      if (Capacitor.isNativePlatform()) {
        try {
          // iOS deep link to the app's settings page — same scheme the
          // notifications-permission affordance uses in ProfileScreen.
          // @capacitor/browser is already in the bundle for that path.
          const { Browser } = await import('@capacitor/browser');
          await Browser.open({ url: 'app-settings:' });
          return;
        } catch {
          // Fall through to the raw href below.
        }
        try {
          window.location.href = 'app-settings:';
        } catch { /* swallow */ }
        return;
      }
      // Web fallback — best we can do is nudge the user to flip the
      // browser's permission UI; there's no reliable cross-browser
      // deep link, so we just open a new tab as a hint.
      try {
        window.open('about:preferences', '_blank');
      } catch { /* swallow */ }
      return;
    }

    // Permission is still actionable — fire the in-app prompt.
    const next = await userLocationFull.requestPermission();
    if (next === 'granted' || next === 'denied') {
      markLocationPromptDismissed();
      setLocationPromptDismissed(true);
    }
  }, [userLocationFull]);

  // Push notifications — only activates on native iOS when signed in
  usePushNotifications(user?.id ?? null, city);

  // Fetch user's cover purchases on sign-in
  useEffect(() => { if (user?.id) fetchMyPurchases(); }, [user?.id, fetchMyPurchases]);

  // GPS-based market auto-select on native iOS when location is already granted.
  // Suppressed while the cold-open is playing so the camera doesn't fight the
  // intro's scripted flyTo sequence.
  useEffect(() => {
    if (!user) return;
    if (!Capacitor.isNativePlatform()) return;
    if (coldOpen.active) return;

    (async () => {
      try {
        const { Geolocation } = await import('@capacitor/geolocation');
        const perm = await Geolocation.checkPermissions();
        if (perm.location !== 'granted') return;
        const position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: false,
          timeout: 5000,
        });
        const { nearestMarket, DEFAULT_CITY } = await import('./lib/constants');
        const nearest = nearestMarket(position.coords.latitude, position.coords.longitude);
        switchCity(nearest ?? DEFAULT_CITY);
      } catch (err) {
        console.warn('[venuu] GPS market detection failed:', err);
      }
    })();
  }, [user, switchCity, coldOpen.active]);

  // VenueSheet's "Ask Venny" button — now opens the Venny pill on the
  // tonight tab with the focused venue's name in context (Precap tab
  // retired). The focused-venue ref is read by VennySheet via the
  // focusedVenueName prop so the agent can reference "this place".
  const handleAskVenny = useCallback((venue: Venue, headcount: Headcount | null) => {
    setFocusedVenue({ venue, headcount });
    setTab('tonight');
    setVennyOpen(true);
  }, []);

  // ── Venny highlight handlers ─────────────────────────────────────
  // When Venny calls highlight_on_map, we mark those venue IDs and
  // start a 30s auto-clear timer so the map doesn't stay frozen on a
  // stale recommendation. Each new highlight resets the timer.
  const handleVennyHighlight = useCallback((venueIds: string[]) => {
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
    setHighlightedVenueIds(venueIds);
    if (venueIds.length > 0) {
      highlightTimerRef.current = setTimeout(() => {
        setHighlightedVenueIds([]);
        highlightTimerRef.current = null;
      }, 30_000);
    }
  }, []);

  // Tap on a VenueResultCard inside Venny → fly the camera and close
  // the sheet. We pull the map instance from the same ref the share
  // hook uses (assigned by TonightPage via onMapReady).
  const handleVennyFlyToVenue = useCallback((_venueId: string, lng: number, lat: number) => {
    const map = tonightMapRef.current;
    if (!map) return;
    map.flyTo({
      center: [lng, lat],
      zoom: Math.max(map.getZoom(), 15),
      duration: 800,
      essential: true,
    });
    setTab('tonight');
    setVennyOpen(false);
  }, []);

  // ── Profile → Venny bridges ──────────────────────────────────────
  // "Tell Venny more" / "Tell Venny your taste" CTAs from the profile.
  // Accepts an optional priming message that the sheet auto-sends on
  // open so the user's first tap kicks off a coherent conversation.
  const handleOpenVennyFromProfile = useCallback((initialMessage?: string) => {
    setVennyInitialMessage(initialMessage ?? null);
    setTab('tonight');
    setVennyOpen(true);
  }, []);

  // Clean up the auto-clear timer on unmount.
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  // Push-notification listener readiness signal. usePushNotifications
  // buffers cold-launch push events until this fires — PushBanner (and
  // any other 'push-notification' consumer) depends on it firing exactly
  // once per app launch, independent of which notification kinds exist.
  useEffect(() => {
    markPushListenerReady();
  }, []);

  // Build counts map from headcounts — any venue with count > 0 tonight shows on map.
  // Headcounts persist for the entire night regardless of whether the bouncer is still connected.
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [venueId, hc] of Object.entries(headcounts)) {
      if (hc.current_count > 0) {
        map[venueId] = hc.current_count;
      }
    }
    return map;
  }, [headcounts]);

  // Total count across all venues with headcount tonight
  const totalCount = useMemo(() => {
    return Object.values(counts).reduce((sum, c) => sum + c, 0);
  }, [counts]);

  // Set of venue IDs with a live bouncer actively tracking (green LIVE badge).
  // This only controls the LIVE badge — the headcount and glow stay regardless.
  const liveVenueIds = useMemo(() => {
    return new Set(
      Object.entries(headcounts)
        .filter(([, hc]) => hc.is_live && hc.current_count > 0)
        .map(([id]) => id)
    );
  }, [headcounts]);

  // Public profile route — /u/{16-hex-token}. Renders a marketing
  // surface (no map, no Venny, no nav) so a link recipient gets a
  // clean read-only view + download CTA. Short-circuits everything
  // below so cold-open and full-app state never spin up.
  if (publicShareToken) {
    return (
      <PublicProfilePage
        shareToken={publicShareToken}
        viewerProfileId={profile?.id ?? null}
        onClose={() => {
          // Drop the path back to root and re-render the full app.
          try {
            window.history.replaceState({}, '', '/');
          } catch { /* swallow */ }
          window.location.reload();
        }}
      />
    );
  }

  // Missing env error screen
  if (!envReady) {
    return (
      <div className="min-h-screen bg-[#050507] flex items-center justify-center px-6">
        <div className="text-center">
          <h1 className="text-white font-black text-2xl tracking-[0.05em] mb-4"
            style={{ fontFamily: 'Satoshi, sans-serif' }}>
            venuu
          </h1>
          <div className="bg-[#111114] border border-[#2A2A30] rounded-xl p-5">
            <p className="text-[#FF5E1A] font-medium text-sm mb-2" style={{ fontFamily: 'Satoshi, sans-serif' }}>
              Missing configuration
            </p>
            <p className="text-[#8A8A95] text-sm" style={{ fontFamily: 'Satoshi, sans-serif' }}>
              Check your .env file.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // City onboarding — first open
  if (!onboarded) {
    return (
      <OnboardingScreen
        onComplete={() => {
          localStorage.setItem('venuu_onboarded', 'true');
          setOnboarded(true);
        }}
        signInWithApple={signInWithApple}
      />
    );
  }

  // Connection error — venues failed to load
  if (venuesError && venues.length === 0) {
    return (
      <div className="min-h-screen bg-[#050507] flex items-center justify-center px-6">
        <div className="text-center">
          <h1 className="text-white font-black text-2xl tracking-[0.05em] mb-4"
            style={{ fontFamily: 'Satoshi, sans-serif' }}>
            venuu
          </h1>
          <p className="text-[#8A8A95] text-sm mb-4" style={{ fontFamily: 'Satoshi, sans-serif' }}>
            Having trouble connecting...
          </p>
          <button
            type="button"
            onClick={refetchVenues}
            className="px-6 rounded-xl text-white font-bold text-sm active:scale-[0.97] transition-transform"
            style={{ fontFamily: 'Satoshi, sans-serif', background: '#FF8200', height: 48, minWidth: 120, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050507] relative">
      <Header
        city={city}
        onCityChange={switchCity}
        totalCount={totalCount}
        activeTab={tab}
      />

      {/* Events-mode lineup — pill that expands to a 3-snap sheet */}
      <EventLineupSheet
        visible={mapMode === 'events' && tab === 'tonight' && !activeHubId}
        city={city}
        userId={profile?.id ?? null}
        snap={sheetSnap}
        onSnapChange={setSheetSnap}
        glowingEventId={glowingEventId}
        onCardTap={(evt) => {
          setActiveEvent(evt);
          flyMapToEvent(evt);
        }}
      />

      {/* Host hub card — premium half-sheet for hub venues in events mode */}
      <HostHubCard
        hubId={activeHubId}
        userId={profile?.id ?? null}
        visible={!!activeHubId && mapMode === 'events'}
        onClose={() => setActiveHubId(null)}
      />

      {/* Top-of-map time scrubber — sweep nights to re-light beacons.
       *  Hidden while the hub card is up so it doesn't fight the card. */}
      <EventScrubber
        events={events}
        activeWindow={scrubberWindow}
        activeChipId={scrubberChipId}
        visible={mapMode === 'events' && tab === 'tonight' && !activeHubId}
        onSelect={(win: EventWindow, chip: WindowChip) => {
          setScrubberWindow(win);
          setScrubberChipId(chip.id);
        }}
      />

      {/* Bottom-center toggle — flips between VIBE and EVENTS modes.
       *  Only on the Tonight tab; the map (and events) live there.
       *  Dims per snap: full at pill, 30% at mid, hidden at full. */}
      <EventsToggle
        mode={mapMode}
        onChange={setMapMode}
        hidden={tab !== 'tonight'}
        dimLevel={
          mapMode === 'vibe'   ? 1 :
          activeHubId          ? 0 :  // hub card takes the screen
          sheetSnap === 'pill' ? 1 :
          sheetSnap === 'mid'  ? 0.3 :
          0
        }
      />

      {/* Venue-name toast — brief top-center label on events pin tap. */}
      <VenueToast message={venueToast} />

      {/* Venny pill bar — only on tonight tab + when the cold-open is
       *  finished, so it doesn't peek behind the intro overlay. */}
      {tab === 'tonight' && !coldOpen.active && (
        <div
          style={{
            // The transform below creates a stacking context; without an
            // explicit position+zIndex the pill's own z-index:590 is
            // trapped here at root `auto`, so the map canvas paints over
            // it. Lift the wrapper to VennyBar's intended level (590 —
            // below The Drop's 600, above the map) so the pill shows.
            position: 'relative',
            zIndex: 590,
            transition: 'opacity 350ms cubic-bezier(0.32, 0.72, 0, 1), transform 350ms cubic-bezier(0.32, 0.72, 0, 1)',
            opacity: mapMode === 'events' ? 0 : 1,
            transform: mapMode === 'events' ? 'translateY(60px)' : 'translateY(0)',
            pointerEvents: mapMode === 'events' ? 'none' : 'auto',
          }}
        >
          <VennyBar
            onExpand={() => setVennyOpen(true)}
            sheetOpen={vennyOpen}
          />
        </div>
      )}

      {/* Location permission prompt — one-time floating card. */}
      {showLocationPrompt && (
        <LocationPermissionCard
          onAllow={handleAllowLocation}
          onDismiss={() => setLocationPromptDismissed(true)}
        />
      )}

      {/* Tonight tab — map + venue cards */}
      <div className={tab === 'tonight' ? '' : 'hidden'}>
        <TonightPage
          city={city}
          venues={venues}
          counts={counts}
          headcounts={headcounts}
          liveVenueIds={liveVenueIds}
          pulsedVenueId={pulsedVenueId}
          events={events}
          userLocation={userLocation}
          coverPrices={coverPrices}
          purchasing={purchasing}
          myPurchases={myPurchases as Map<string, { qr_code: string }>}
          onBuyCover={purchaseCover}
          username={username}
          userId={user?.id ?? null}
          onSignIn={() => setShowSignIn(true)}
          onCityChange={switchCity}
          onAskVenny={handleAskVenny}
          introActive={coldOpen.active}
          introPhase={coldOpen.phase}
          onMapReady={(m) => { tonightMapRef.current = m; }}
          onShareGlobe={shareGlobe.share}
          sharingGlobe={shareGlobe.sharing}
          highlightedVenueIds={highlightedVenueIds}
          mapMode={mapMode}
          onEventPinClick={handleEventPinClick}
          glowEventId={glowingEventId}
          onVenueHubOpen={setActiveHubId}
          onMapBackgroundTap={() => setSheetSnap(prev => prev !== 'pill' ? 'pill' : prev)}
          litEventVenueIds={litVenueIds}
          selectedRangeStart={selectedRange?.start ?? null}
          selectedRangeEnd={selectedRange?.end ?? null}
          eventWindowLabel={({ tonight: 'TONIGHT', week: 'THIS WEEK', month: 'THIS MONTH', specials: '' } as Record<EventWindow, string>)[scrubberWindow]}
        />
      </div>

      {/* Community tab — leaderboard/bar-ownership, a first-class
       *  destination like Tonight. Public data (readable signed out or
       *  in), so unlike the You tab it isn't gated on a signed-in user. */}
      <div className={tab === 'community' ? '' : 'hidden'}>
        <CommunityPage profileId={profile?.id ?? null} onOpenSignIn={() => setShowSignIn(true)} />
      </div>

      {/* You tab — profile as a first-class destination. Only mounted
       *  when both signed in and onboarded so we don't ship a half-state
       *  to the new ProfileScreen during the nickname flow. */}
      {tab === 'you' && user && profile && !needsOnboard && (
        <div style={{ position: 'absolute', inset: 0, top: 0, bottom: 0 }}>
          <ProfileScreen
            profile={profile}
            onClose={() => setTab('tonight')}
            onSignOut={signOut}
            onProfileRefresh={refreshProfile}
            onOpenVenny={handleOpenVennyFromProfile}
            onOpenTasteFlow={() => setTasteFlowOpen(true)}
            onOpenPortal={() => setPortalOpen(true)}
            locationPermissionStatus={userLocationFull.permissionStatus}
            onRequestLocationPermission={handleAllowLocation}
          />
        </div>
      )}

      {/* Venue-staff tools — full-screen takeover, reached only via
       *  ProfileScreen's "Venue / Partner Login" entry. Not part of the
       *  tab bar; PortalPage owns its own PIN/org-code auth, independent
       *  of consumer sign-in. */}
      {portalOpen && (
        // zIndex must clear the app-level Header's hardcoded 1000 (not
        // the documented --z-modal:200 token, which sits BELOW it) —
        // this is a full takeover that needs to cover the venuu chrome
        // entirely, header included.
        <div style={{ position: 'fixed', inset: 0, zIndex: 1001, background: '#050507' }}>
          <PortalPage onExit={() => setPortalOpen(false)} />
        </div>
      )}

      <PushBanner />
      {/* Bottom nav stays visible — the plan sheet snaps to PILL or
       *  CARD heights that leave the nav reachable. FULL covers it
       *  naturally; the user drags down to expose it again. */}
      <BottomNav
        active={tab}
        onChange={(next) => {
          // Guest tap on "You" → open SignInSheet rather than route
          // them into a half-state profile. Other tabs route normally.
          if (next === 'you' && !user) {
            setShowSignIn(true);
            return;
          }
          setTab(next);
        }}
      />

      {/* Cinematic cold open — 7-phase intro on first/returning launch. */}
      <AnimatePresence>
        {coldOpen.active && (
          <CinematicIntro
            key="cold-open"
            phase={coldOpen.phase}
            mode={coldOpen.mode}
            onSkip={coldOpen.skip}
            onComplete={coldOpen.complete}
            cityAggregates={cityAggregatesData.aggregates}
            totalPeopleOut={cityAggregatesData.totalPeopleOut}
            targetCity={city}
            targetCityName={targetCityName}
            mapRef={tonightMapRef}
          />
        )}
      </AnimatePresence>

      {/* Sign In Sheet — shown when not authenticated */}
      {showSignIn && (
        <SignInSheet
          onClose={() => setShowSignIn(false)}
          onSignedIn={() => setShowSignIn(false)}
          signInWithApple={signInWithApple}
          onOpenPortal={() => { setShowSignIn(false); setPortalOpen(true); }}
        />
      )}

      {/* (Legacy overlay-mounted ProfileScreen removed — it now lives
       *   on the 'you' tab above. `showProfile` state is retained
       *   strictly to keep the guest-only ProfileOverlay path below
       *   working, since both share the same state mailbox.) */}

      {/* Full-screen nickname setup — shown automatically after sign-in if no profile */}
      {user && needsOnboard && (
        <NicknameScreen
          onComplete={(username) => createProfile(username, null, city)}
        />
      )}

      {/* Venny bottom sheet — Anthropic-powered map-resident agent. */}
      <VennySheet
        open={vennyOpen}
        onClose={() => setVennyOpen(false)}
        city={city}
        userId={user?.id ?? null}
        focusedVenueName={focusedVenue?.venue.name ?? null}
        onHighlight={handleVennyHighlight}
        onFlyToVenue={handleVennyFlyToVenue}
        initialMessage={vennyInitialMessage}
        onInitialMessageHandled={() => setVennyInitialMessage(null)}
      />

      {/* Profile Overlay — sign-in prompt for guests */}
      <ProfileOverlay
        open={showProfile && !user}
        onClose={() => setShowProfile(false)}
        isLoggedIn={false}
        needsOnboard={false}
        onSendMagicLink={sendMagicLink}
        onCompleteOnboard={createProfile}
        onBrowseAsGuest={() => setShowProfile(false)}
      />

      {/* TasteFlow — structured 7-step taste calibration. Opens from
       *  the profile's "Quick setup" CTA. Writes user_preferences
       *  directly; Venny picks it up on the next get_user_taste call. */}
      <TasteFlow
        open={tasteFlowOpen}
        onClose={() => setTasteFlowOpen(false)}
        userId={user?.id ?? null}
        profile={profile}
        onCompleted={() => {
          // After successful submit, drop the user into Venny so the
          // freshly-saved taste is immediately useful.
          setTasteFlowOpen(false);
          setTab('tonight');
          setVennyOpen(true);
        }}
      />

    </div>
  );
}
