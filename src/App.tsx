import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { hapticMedium } from './lib/haptics';
import { AnimatePresence } from 'framer-motion';
import type { Map as MapboxMap } from 'mapbox-gl';
import { supabase, envReady } from './lib/supabase';
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
import { PortalPage } from './pages/PortalPage';
import { PublicProfilePage } from './pages/PublicProfilePage';
import { VennyBar } from './components/Venny/VennyBar';
import { VennySheet } from './components/Venny/VennySheet';
import PaintScreen from './components/Paint/PaintScreen';
import PaintCeremony from './components/Paint/PaintCeremony';
import type { VibeHueId } from './lib/hueMath';
import type { Plan as VennyPlan } from './components/Venny/PlanCard';
import { SignInSheet } from './components/Auth/SignInSheet';
import { NicknameScreen } from './components/Auth/NicknameScreen';
import { ProfileOverlay } from './components/Profile/ProfileOverlay';
import { ProfileScreen } from './components/Profile/ProfileScreen';
import { PlanSheet } from './components/PlanSheet/PlanSheet';
import { EndNightCeremony } from './components/PlanExecution/EndNightCeremony';
import type { LiveStopState } from './components/PlanExecution/StopCard';
import { MiniVennyPill } from './components/PlanExecution/MiniVennyPill';
import { hapticLight } from './lib/haptics';
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
import type { Venue, Headcount } from './lib/types';

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
  const [focusedVenue, setFocusedVenue] = useState<{ venue: Venue; headcount: Headcount | null } | null>(null);
  const username = localStorage.getItem('venue_username') ?? 'Guest';
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem('venuu_onboarded') === 'true');
  const [showSignIn, setShowSignIn] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  // ── Venny v1.2.1 — optional priming message ──────────────────────
  // When the profile's "Tell Venny your taste" banner is tapped, we
  // open the sheet with a message ready to auto-send so Venny starts
  // the taste-capture conversation in one tap.
  const [vennyInitialMessage, setVennyInitialMessage] = useState<string | null>(null);
  // ── Ship 3 — passive visit credit for active-plan stops ──
  // Updated when the proximity detector emits 'venuu-plan-stop-visited'
  // for a venue that matches a stop in the current activePlan.
  // Cleared whenever activePlan changes (different plan → fresh set).
  const [visitedStopIndices, setVisitedStopIndices] = useState<number[]>([]);
  // If the user saves the current plan, Venny returns the night_plans
  // row id. We hold it so subsequent ENTER events can persist
  // visited_at onto the matching index in night_plans.stops JSONB.
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  // Tinder-style taste calibration flow — full-screen modal opened
  // from the profile's "Quick setup" CTA (Session B). Independent of
  // VennySheet so the user can finish/skip without involving Venny.
  const [tasteFlowOpen, setTasteFlowOpen] = useState(false);
  // ── Venny v1.1 ──
  const [vennyOpen, setVennyOpen] = useState(false);
  const [highlightedVenueIds, setHighlightedVenueIds] = useState<string[]>([]);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ── Venny v1.2 — active multi-stop plan ──
  // Set when Venny's compose_plan returns; drives the MapView route
  // line + numbered markers + the VennySheet's adaptive height.
  const [activePlan, setActivePlan] = useState<VennyPlan | null>(null);
  // ── Plan Execution Mode (Ship 4) — full-screen takeover when the
  //    user activates a saved plan from the profile carousel or from
  //    tapping a stop marker on the main map. focusStopIndex is set
  //    only for the map-tap path so the page can scroll to that stop
  //    instead of the derived current one.
  // ── Plan Sheet — three-state bottom sheet that lives on the map.
  //    App owns sheetState so MapView + map-dim-overlay can react.
  //    The End-Night Ceremony is a separate full-screen moment fired
  //    after the sheet dismisses on completion.
  const [activePlanSheet, setActivePlanSheet] = useState<{
    planId: string;
    state: 'pill' | 'card' | 'full';
    focusStopIndex?: number;
  } | null>(null);
  const [endNightCeremony, setEndNightCeremony] = useState<{ planId: string } | null>(null);

  // PHASE D: paint flow state
  const [paintScreenOpen, setPaintScreenOpen] = useState(false);
  const [paintCeremonyOpen, setPaintCeremonyOpen] = useState(false);
  const [activePaintVenue, setActivePaintVenue] = useState<{
    id: string;
    name: string;
    lat: number;
    lng: number;
  } | null>(null);
  const [paintedHueId, setPaintedHueId] = useState<VibeHueId | null>(null);
  const [paintPromptId, setPaintPromptId] = useState<string | null>(null);
  const [paintVisitLabel, setPaintVisitLabel] = useState<string>('');
  // PlanSheet expects a live-state lookup per venue. v1 ships with an
  // empty Map (everything falls back to the `unknown` accent); a
  // follow-up can populate from headcount_estimates when activePlan
  // is mounted. Keeping the type concrete so Block 3 has a clear hook.
  const planSheetLiveByVenueId = useMemo<Map<string, LiveStopState>>(() => new Map(), []);
  const { city, switchCity } = useCity();
  const { user, profile, needsOnboard, signInWithApple, sendMagicLink, createProfile, signOut, refreshProfile } = useAuth();
  const { venues, error: venuesError, refetch: refetchVenues } = useVenues(city);
  const cityAggregatesData = useCityAggregates();
  const tonightMapRef = useRef<MapboxMap | null>(null);

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
  // ── Foreground location — tighter polling + high-accuracy when on
  // a plan so the proximity detector can credit stops faster.
  const userLocationFull = useUserLocation({
    enabled: !!user && !coldOpen.active,
    pollIntervalMs: activePlan ? 30_000 : 60_000,
    highAccuracy: !!activePlan,
  });
  const userLocation = userLocationFull.location;
  const { coverPrices } = useCoverPricing(city);
  const { purchasing, myPurchases, purchaseCover, fetchMyPurchases } = useCoverPurchase(user?.id ?? null);

  // ── Passive presence — credits user_visits when the user lingers
  //    inside a venue's geofence (60m enter, 100m exit hysteresis,
  //    20-min cooldown) and emits ENTER events that the active-plan
  //    UI uses for per-stop checkmarks.
  const handleVenueEnter = useCallback((venueId: string) => {
    if (!activePlan) return;
    const idx = activePlan.stops.findIndex(s => s.venue_id === venueId);
    if (idx < 0) return;
    const detail = { venueId, stopIndex: idx, visitedAt: new Date().toISOString() };
    // Canonical event (Ship 4). Legacy alias kept so the PlanCard tick
    // logic and other in-flight consumers keep working until they're
    // migrated.
    window.dispatchEvent(new CustomEvent('venuu-plan-stop-arrived', { detail }));
    window.dispatchEvent(new CustomEvent('venuu-plan-stop-visited', { detail }));
  }, [activePlan]);

  useProximityDetection({
    userLat: userLocationFull.lat,
    userLng: userLocationFull.lng,
    userAccuracy: userLocationFull.accuracy,
    venues,
    enabled: !!profile?.id && !coldOpen.active,
    userId: profile?.id ?? null,
    onVenueEnter: handleVenueEnter,
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

  // ── Plan handlers ────────────────────────────────────────────────
  // compose_plan returned a plan → render route line on the map, clear
  // any leftover Venny highlight (the plan stops are the highlight now),
  // and switch to the tonight tab so the map is visible.
  const handleActivatePlan = useCallback((plan: VennyPlan | null) => {
    setActivePlan(plan);
    if (plan) {
      setTab('tonight');
      // Drop the bubble-highlight set: the route markers carry attention.
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
      setHighlightedVenueIds([]);
    }
  }, []);

  // Tap a numbered route marker on the main map. Behaviour depends
  // on whether a plan sheet is already mounted for this plan:
  //   • Sheet open for this plan  → shift focus to the tapped stop,
  //                                  expand PILL → CARD if needed,
  //                                  fly the camera.
  //   • Sheet not open (yet)      → open the sheet focused on that
  //                                  stop with fromMap=true so we
  //                                  skip the cinematic tab/camera
  //                                  sequence (we're already on map).
  const handlePlanStopTap = useCallback(async (stopIndex: number) => {
    const map = tonightMapRef.current;
    const stop = activePlan?.stops?.[stopIndex];
    if (!map || !stop || !activePlanId) return;

    if (activePlanSheet?.planId === activePlanId) {
      setActivePlanSheet(prev => prev ? {
        ...prev,
        focusStopIndex: stopIndex,
        state: prev.state === 'pill' ? 'card' : prev.state,
      } : null);
      map.flyTo({
        center: [stop.lng, stop.lat],
        zoom: Math.max(map.getZoom(), 15.5),
        speed: 1.4,
        curve: 1.2,
        essential: true,
      });
      return;
    }

    // No sheet yet — mount it focused on this stop. We can mount
    // directly here (rather than calling handleOpenPlanSheet) because
    // we're already on the tonight tab and the activePlan mirror was
    // set when this plan was activated. Avoid forward-referencing the
    // handler so handlePlanStopTap stays self-contained.
    map.flyTo({
      center: [stop.lng, stop.lat],
      zoom: Math.max(map.getZoom(), 15.5),
      speed: 1.4,
      curve: 1.2,
      essential: true,
    });
    setActivePlanSheet({
      planId: activePlanId,
      state: 'card',
      focusStopIndex: stopIndex,
    });
  }, [activePlan, activePlanId, activePlanSheet]);

  // ── Profile → Venny bridges ──────────────────────────────────────
  // "Tell Venny more" / "Tell Venny your taste" CTAs from the profile.
  // Accepts an optional priming message that the sheet auto-sends on
  // open so the user's first tap kicks off a coherent conversation.
  const handleOpenVennyFromProfile = useCallback((initialMessage?: string) => {
    setVennyInitialMessage(initialMessage ?? null);
    setTab('tonight');
    setVennyOpen(true);
  }, []);

  // ── Plan Sheet handlers (Block 2 — replaces the takeover path) ──

  // Open the three-state plan sheet. Three activation modes:
  //
  //   • FRESH ACTIVATION  (planned, never run)
  //     → medium haptic, optional tab switch + flyTo (cinematic),
  //       slide-up animation. The "crossing the threshold" beat.
  //
  //   • RE-ENTRY          (status=active, activated_at set)
  //     → light haptic, optional tab switch then easeTo(300ms),
  //       no flyTo. Resume in place rather than re-do the
  //       ceremony.
  //
  //   • RE-RUN            (post "run it again" — handled in
  //                        PlanSheet itself by resetting status
  //                        back to active + clearing activated_at,
  //                        so when the sheet remounts it reads as
  //                        fresh activation here).
  //
  // The check uses a single DB round-trip up front so we can also
  // pull the focus-stop coordinates for the camera move.
  const handleOpenPlanSheet = useCallback(async (
    planId: string,
    options?: { state?: 'pill' | 'card' | 'full'; focusStopIndex?: number; fromMap?: boolean },
  ) => {
    const { data: planData } = await supabase
      .from('night_plans')
      .select('id, title, summary, status, activated_at, stops, current_stop_index, total_estimated_cost, total_duration_min, start_time, end_time, vibe_tags')
      .eq('id', planId)
      .maybeSingle();
    if (!planData) return;

    const planRow = planData as {
      id: string;
      title?: string;
      summary?: string | null;
      status?: string;
      activated_at?: string | null;
      stops?: VennyPlan['stops'];
      current_stop_index?: number;
      total_estimated_cost?: number | null;
      total_duration_min?: number | null;
      start_time?: string | null;
      end_time?: string | null;
      vibe_tags?: string[];
    };

    // Mirror the plan into activePlan so MapView keeps rendering the
    // route + markers behind the sheet.
    const vennyPlan: VennyPlan = {
      title: planRow.title ?? 'Plan',
      summary: planRow.summary ?? null,
      stops: planRow.stops ?? [],
      vibe_tags: (planRow.vibe_tags ?? []) as string[],
      total_estimated_cost: planRow.total_estimated_cost ?? null,
      total_duration_min: planRow.total_duration_min ?? null,
      start_time: planRow.start_time ?? null,
      end_time: planRow.end_time ?? null,
    };
    setActivePlan(vennyPlan);
    queueMicrotask(() => setActivePlanId(planId));

    const initialSheetState = options?.state ?? 'card';
    const focusIdx = options?.focusStopIndex ?? planRow.current_stop_index ?? 0;
    const focusStop = planRow.stops?.[focusIdx];

    const isAlreadyActivated =
      planRow.status === 'active' && !!planRow.activated_at;

    if (isAlreadyActivated && !options?.fromMap) {
      // ── RE-ENTRY path — gentle ────────────────────────────────
      void hapticLight();
      if (tab !== 'tonight') {
        setTab('tonight');
        await new Promise(r => setTimeout(r, 80));
      }
      const map = tonightMapRef.current;
      if (map && focusStop && typeof focusStop.lat === 'number' && typeof focusStop.lng === 'number') {
        map.easeTo({
          center: [focusStop.lng, focusStop.lat],
          zoom: 15,
          duration: 300,
        });
      }
      setActivePlanSheet({
        planId,
        state: initialSheetState,
        focusStopIndex: options?.focusStopIndex,
      });
      return;
    }

    // ── FRESH ACTIVATION (or re-run) — full cinematic ─────────
    void hapticMedium();
    if (tab !== 'tonight' && !options?.fromMap) {
      setTab('tonight');
      await new Promise(r => setTimeout(r, 120));
      const map = tonightMapRef.current;
      if (map && focusStop && typeof focusStop.lat === 'number' && typeof focusStop.lng === 'number') {
        map.flyTo({
          center: [focusStop.lng, focusStop.lat],
          zoom: 14,
          speed: 1.0,
          curve: 1.2,
          essential: true,
        });
      }
      await new Promise(r => setTimeout(r, 200));
    }

    setActivePlanSheet({
      planId,
      state: initialSheetState,
      focusStopIndex: options?.focusStopIndex,
    });
  }, [tab]);

  const handleDismissPlanSheet = useCallback(() => {
    void hapticLight();
    setActivePlanSheet(null);
  }, []);

  const handlePlanSheetCompleted = useCallback(() => {
    setActivePlanSheet(prev => {
      if (!prev) return null;
      // Schedule the ceremony to fire just after the sheet's dismiss
      // animation settles so the two overlays don't fight for the
      // user's attention.
      const completedPlanId = prev.planId;
      window.setTimeout(() => {
        setEndNightCeremony({ planId: completedPlanId });
      }, 150);
      return null;
    });
  }, []);

  const handleSheetStateChange = useCallback((newState: 'pill' | 'card' | 'full') => {
    setActivePlanSheet(prev => prev ? { ...prev, state: newState } : null);
  }, []);

  const handleFocusStopChange = useCallback((stopIndex: number) => {
    setActivePlanSheet(prev => prev ? { ...prev, focusStopIndex: stopIndex } : null);
  }, []);

  const handleCeremonyComplete = useCallback(() => {
    setEndNightCeremony(null);
    // Drop the map's route + markers once the ceremony fades —
    // MapView's plan-rendering effect tears the layers down on
    // activePlan === null. Also clear the saved-plan id mirror so
    // the next plan activation starts fresh.
    setActivePlan(null);
    setActivePlanId(null);
  }, []);

  // Tap a plan card on the profile → enter Plan Execution Mode.
  // Translate the MyPlan shape to the snake_case Venny Plan so the
  // main map's route line stays visible during the threshold-crossing
  // beat, then run the cinematic activation sequence:
  //
  //   1. Haptic medium + brief card press feedback (CSS)
  //   2. Switch tab to 'tonight' so the map becomes the stage
  //   3. Beat ~120ms for the tab transition
  //   4. Camera flyTo the focus stop (or stop 1) — speed 1.2, curve 1.3
  //   5. Beat ~200ms for the camera to start moving
  //   6. Mount the execution page with its slide-up animation
  //
  // If the user is already on 'tonight' (e.g. tap-from-map cinematic
  // Mini Venny pill inside the plan sheet → open the Venny sheet
  // with the live plan context as a priming message. The execution
  // page stays mounted underneath so the user lands back on it when
  // they dismiss the sheet.
  const handleOpenVennyFromExecution = useCallback((context: string) => {
    setVennyInitialMessage(context);
    setVennyOpen(true);
  }, []);

  // Clean up the auto-clear timer on unmount.
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  // Reset visited-stop tracker whenever the user activates a fresh
  // plan. Also clear the saved-plan id so we don't accidentally
  // persist visited_at onto a stale plan row.
  useEffect(() => {
    setVisitedStopIndices([]);
    setActivePlanId(null);
  }, [activePlan]);

  // Listen for the proximity detector's ENTER events on plan stops
  // (App.tsx itself dispatched these in handleVenueEnter above) and
  // remember the index so the PlanCard can render a green checkmark
  // next to that stop's row. If the plan has been saved (activePlanId
  // is set), also persist arrived_at + the legacy visited_at alias
  // into the matching index of night_plans.stops JSONB so a future
  // re-open of the plan from the profile carousel remembers progress.
  //
  // NOTE: PlanSheet's own markArrived writes a richer patch (advances
  // current_stop_index + sets confirmed_manually) for I'M HERE taps.
  // The persist below is the proximity-detector path — fires when
  // the sheet isn't necessarily mounted, so we always run it.
  useEffect(() => {
    if (!activePlan) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { stopIndex?: number; visitedAt?: string } | undefined;
      const idx = detail?.stopIndex;
      if (typeof idx !== 'number') return;
      setVisitedStopIndices(prev => (prev.includes(idx) ? prev : [...prev, idx]));

      if (activePlanId && envReady) {
        const visitedAt = detail?.visitedAt ?? new Date().toISOString();
        (async () => {
          try {
            const { data, error } = await supabase
              .from('night_plans')
              .select('stops')
              .eq('id', activePlanId)
              .maybeSingle();
            if (error || !data) return;
            const stops = Array.isArray(data.stops) ? [...(data.stops as unknown[])] : [];
            if (idx < 0 || idx >= stops.length) return;
            const existing = (stops[idx] ?? {}) as Record<string, unknown>;
            if (existing.arrived_at || existing.visited_at) return; // first ENTER wins
            stops[idx] = { ...existing, arrived_at: visitedAt, visited_at: visitedAt };
            const { error: updErr } = await supabase
              .from('night_plans')
              .update({ stops })
              .eq('id', activePlanId);
            if (updErr) {
              console.warn('[plan_stops] persist arrived_at failed:', updErr.message);
            }
          } catch (err) {
            console.warn('[plan_stops] persist threw:', err);
          }
        })();
      }
    };
    // Listen for both event names — canonical + legacy alias.
    window.addEventListener('venuu-plan-stop-arrived', handler as EventListener);
    window.addEventListener('venuu-plan-stop-visited', handler as EventListener);
    return () => {
      window.removeEventListener('venuu-plan-stop-arrived', handler as EventListener);
      window.removeEventListener('venuu-plan-stop-visited', handler as EventListener);
    };
  }, [activePlan, activePlanId]);

  // ── PlanSheet → main map sync. When PlanSheet writes to a stop
  //    (arrived / skipped) it dispatches `venuu-plan-sheet-stops-
  //    updated` with the latest stops array. Mirror that into
  //    activePlan so MapView's plan markers re-paint with the right
  //    arrived/skipped/current state.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { planId?: string; stops?: VennyPlan['stops']; current_stop_index?: number }
        | undefined;
      if (!detail?.stops) return;
      // Guard: only mirror updates for the currently mounted sheet's
      // plan, so a stale event from a previously-dismissed sheet
      // can't resurrect activePlan on the map.
      if (!activePlanSheet || detail.planId !== activePlanSheet.planId) return;
      setActivePlan(prev => (prev ? { ...prev, stops: detail.stops! } : prev));
    };
    window.addEventListener('venuu-plan-sheet-stops-updated', handler as EventListener);
    return () => window.removeEventListener('venuu-plan-sheet-stops-updated', handler as EventListener);
  }, [activePlanSheet]);

  // PHASE D: listen for push-notification CustomEvents with paint_prompt type
  useEffect(() => {
    const handler = async (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (!detail || detail?.data?.type !== 'paint_prompt') return;

      const venueId = detail.data.venue_id as string;
      const promptId = detail.data.paint_prompt_id as string;

      if (!venueId || !promptId) {
        console.warn('[App] paint_prompt push missing venue_id or paint_prompt_id', detail);
        return;
      }

      // Fetch venue coords + prompt visit range for the PaintScreen header
      const [{ data: venueRow }, { data: promptRow }] = await Promise.all([
        supabase.from('venues').select('id, name, lat, lng').eq('id', venueId).single(),
        supabase.from('paint_prompts')
          .select('visit_first_seen_at, visit_last_seen_at')
          .eq('id', promptId)
          .single(),
      ]);

      if (!venueRow) {
        console.warn('[App] paint_prompt venue not found', venueId);
        return;
      }

      const label = promptRow
        ? formatVisitLabel(promptRow.visit_first_seen_at, promptRow.visit_last_seen_at)
        : '';

      setActivePaintVenue({
        id: venueRow.id,
        name: venueRow.name,
        lat: venueRow.lat,
        lng: venueRow.lng,
      });
      setPaintPromptId(promptId);
      setPaintVisitLabel(label);
      setPaintScreenOpen(true);
    };

    window.addEventListener('push-notification', handler);
    markPushListenerReady();
    return () => window.removeEventListener('push-notification', handler);
  }, []);

  // ── activePlan lifecycle bound to activePlanSheet. When the
  //    sheet dismisses (close X, swipe-down past PILL, end-night
  //    completion sequence, etc.) we clear activePlan + the saved-
  //    plan id mirror so the map's route line + stop markers tear
  //    down. handleCeremonyComplete already clears these — this
  //    effect handles the path where the sheet dismisses WITHOUT
  //    completion (mid-plan close).
  useEffect(() => {
    if (activePlanSheet) return;
    setActivePlan(null);
    setActivePlanId(null);
  }, [activePlanSheet]);

  // ── Mirror sheet state onto the body so global CSS rules can
  //    hide the Drop pill, Venny bar, and side controls when the
  //    sheet covers them. PILL keeps everything visible; CARD and
  //    FULL fade pills out. The map-dim-overlay already uses the
  //    same attribute on its own element — this version covers
  //    body-level surfaces (TheDrop / VennyBar) that aren't
  //    descendants of the overlay.
  useEffect(() => {
    if (!activePlanSheet) {
      document.body.removeAttribute('data-sheet-state');
      return;
    }
    document.body.setAttribute('data-sheet-state', activePlanSheet.state);
    return () => { document.body.removeAttribute('data-sheet-state'); };
  }, [activePlanSheet]);

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

      {/* Venny pill bar — only on tonight tab + when the cold-open is
       *  finished, so it doesn't peek behind the intro overlay. */}
      {tab === 'tonight' && !coldOpen.active && (
        <VennyBar
          onExpand={() => setVennyOpen(true)}
          sheetOpen={vennyOpen}
        />
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
          activePlan={activePlan}
          onPlanStopTap={handlePlanStopTap}
          focusedStopIndex={activePlanSheet?.focusStopIndex ?? null}
          sheetState={activePlanSheet?.state ?? null}
        />
      </div>

      {/* Portal tab — fullscreen clicker */}
      <div className={tab === 'portal' ? '' : 'hidden'}>
        <PortalPage onExit={() => setTab('tonight')} />
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
            onOpenPlanExecution={(plan) => { void handleOpenPlanSheet(plan.id); }}
            onOpenVenny={handleOpenVennyFromProfile}
            onOpenTasteFlow={() => setTasteFlowOpen(true)}
            locationPermissionStatus={userLocationFull.permissionStatus}
            onRequestLocationPermission={handleAllowLocation}
          />
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

      {/* Plan Sheet — three-state bottom sheet (PILL / CARD / FULL)
       *  that sits over the map. The dim overlay below it darkens the
       *  underlying map UI proportional to sheet state. */}
      {activePlanSheet && (
        <>
          <div
            className="map-dim-overlay"
            data-sheet-state={activePlanSheet.state}
            aria-hidden
          />
          <PlanSheet
            planId={activePlanSheet.planId}
            sheetState={activePlanSheet.state}
            initialFocusStopIndex={activePlanSheet.focusStopIndex}
            onStateChange={handleSheetStateChange}
            onDismiss={handleDismissPlanSheet}
            onPlanCompleted={handlePlanSheetCompleted}
            onFocusStopChange={handleFocusStopChange}
            profileId={profile?.id ?? null}
            liveByVenueId={planSheetLiveByVenueId}
            userLocation={userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : null}
          />
          {/* Mini Venny pill — slides above the sheet via animated
           *  bottom offset so the user can summon Venny with plan
           *  context preloaded without losing access to the sheet. */}
          <MiniVennyPill
            contextHasUpdate={false}
            onTap={() => handleOpenVennyFromExecution(
              `currently on ${activePlanSheet.planId.slice(0, 8)} plan`,
            )}
            sheetState={activePlanSheet.state}
          />
        </>
      )}

      {/* End-Night Ceremony — full-screen wrap-up moment fired after
       *  the sheet dismisses on completion. */}
      {endNightCeremony && (
        <EndNightCeremony
          planId={endNightCeremony.planId}
          liveByVenueId={planSheetLiveByVenueId}
          onComplete={handleCeremonyComplete}
        />
      )}

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
        onActivatePlan={handleActivatePlan}
        activePlan={activePlan}
        initialMessage={vennyInitialMessage}
        onInitialMessageHandled={() => setVennyInitialMessage(null)}
        visitedStopIndices={visitedStopIndices}
        onPlanSaved={(planId) => setActivePlanId(planId)}
      />

      <PaintScreen
        open={paintScreenOpen}
        onClose={() => {
          setPaintScreenOpen(false);
          setActivePaintVenue(null);
          setPaintPromptId(null);
        }}
        paintPromptId={paintPromptId}
        venueId={activePaintVenue?.id ?? ''}
        venueName={activePaintVenue?.name ?? ''}
        visitTimeRangeLabel={paintVisitLabel}
        onPainted={(hueId) => {
          setPaintedHueId(hueId);
          setPaintScreenOpen(false);
          setPaintCeremonyOpen(true);
        }}
      />

      <PaintCeremony
        open={paintCeremonyOpen}
        hueId={paintedHueId}
        venue={activePaintVenue}
        map={tonightMapRef.current}
        onComplete={() => {
          setPaintCeremonyOpen(false);
          setPaintedHueId(null);
          setActivePaintVenue(null);
          setPaintPromptId(null);
        }}
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

function formatVisitLabel(firstSeen: string, lastSeen: string): string {
  const a = new Date(firstSeen);
  const b = new Date(lastSeen);
  const day = a.toLocaleDateString('en-US', { weekday: 'short' });
  const fmt = (d: Date) => d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).toLowerCase().replace(' ', '');
  return `${day} · ${fmt(a)}–${fmt(b)}`;
}
