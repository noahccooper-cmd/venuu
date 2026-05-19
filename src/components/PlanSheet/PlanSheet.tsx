// deno-lint-ignore-file no-explicit-any
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, useAnimation, type PanInfo } from 'framer-motion';
import { X, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { StopCard, type LiveStopState } from '../PlanExecution/StopCard';
import { ArrivalCelebration } from '../PlanExecution/ArrivalCelebration';
import { RateNightFlow } from '../RateNight/RateNightFlow';
import { hapticLight, hapticMedium, hapticTick } from '../../lib/haptics';
import { accentForState, type StateAccent } from '../../lib/planExecutionTokens';
import { openDirectionsTo } from '../../lib/directions';
import { computeNightOf } from '../../hooks/useProximityDetection';

/**
 * PlanSheet — three-state bottom sheet (PILL / CARD / FULL) that
 * lives on the map during plan execution. The sole plan-execution
 * surface; the prior full-screen takeover has been retired.
 *
 *   • PILL   — slim 44px bar pinned below the wordmark; shows
 *              progress dots + plan title + "stop N of M". Tap or
 *              swipe up to expand.
 *   • CARD   — 60dvh sheet with the focused stop in hero treatment
 *              + a compact progress strip for jumping between stops.
 *   • FULL   — 88dvh sheet with every stop visible + a sticky
 *              "end the night" CTA at the bottom.
 *
 * App.tsx owns `sheetState` so MapView and the dim overlay can react
 * to changes. The sheet is otherwise self-contained: it loads the
 * plan, writes user_visits on arrival, advances the pointer, and
 * fires the ArrivalCelebration overlay.
 */

export type PlanSheetState = 'pill' | 'card' | 'full';

interface PlanSheetProps {
  planId: string;
  initialFocusStopIndex?: number;
  sheetState: PlanSheetState;
  onStateChange: (state: PlanSheetState) => void;
  /** User dismissed the sheet entirely. App tears down activePlanSheet. */
  onDismiss: () => void;
  /** Plan completion finished — App opens the EndNightCeremony. */
  onPlanCompleted: () => void;
  /** User tapped a different stop in the progress strip. App can fly
   *  the map camera to that stop. */
  onFocusStopChange: (stopIndex: number) => void;
  profileId: string | null;
  liveByVenueId: Map<string, LiveStopState>;
  userLocation: { lat: number; lng: number } | null;
}

const SNAP_FRACTIONS = {
  card: 0.60,
  full: 0.88,
};
const PILL_HEIGHT_PX = 44;

function getSnapHeight(state: PlanSheetState): number {
  if (state === 'pill') return PILL_HEIGHT_PX;
  const h = typeof window !== 'undefined' ? window.innerHeight : 800;
  return state === 'card' ? h * SNAP_FRACTIONS.card : h * SNAP_FRACTIONS.full;
}

function findNextOpenIndex(stops: any[], from: number): number {
  for (let i = from; i < stops.length; i++) {
    const s = stops[i];
    if (!s.arrived_at && !s.visited_at && !s.skipped_at) return i;
  }
  return stops.length;
}

export function PlanSheet({
  planId,
  sheetState,
  onStateChange,
  onDismiss,
  onPlanCompleted,
  onFocusStopChange,
  profileId,
  liveByVenueId,
  initialFocusStopIndex,
}: PlanSheetProps) {
  const [plan, setPlan] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCelebration, setShowCelebration] = useState<
    { stop: any; index: number; accent: StateAccent } | null
  >(null);
  const [focusedStopIndex, setFocusedStopIndex] = useState<number | null>(
    initialFocusStopIndex ?? null,
  );
  const [showRerunPrompt, setShowRerunPrompt] = useState(false);
  const [viewOnly, setViewOnly] = useState(false);
  // When true, mount the RateNightFlow over the sheet. Triggered by
  // the "rate this night → make Venny smarter" prompt that shows on
  // view-only mode when the plan is completed but unrated.
  const [showRateFlow, setShowRateFlow] = useState(false);
  // "You've run the table" landing moment — fires exactly once, when
  // the LAST open stop transitions to done (transition from "not
  // resolved" → "resolved"). Clears after the keyframe finishes so
  // the banner stays visible but the animation doesn't replay.
  const [allResolvedJustHappened, setAllResolvedJustHappened] = useState(false);
  const prevAllResolvedRef = useRef(false);
  // Drag-feedback hooks for the handle micro-interaction + snap pulse.
  const [isDragging, setIsDragging] = useState(false);
  const [justSnapped, setJustSnapped] = useState(false);
  // Index of the stop that just transitioned to ARRIVED. Drives the
  // brief green celebratory glow on its card. null otherwise.
  const [justArrivedStopIndex, setJustArrivedStopIndex] = useState<number | null>(null);

  // ── Load plan + activate-on-open ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('night_plans')
        .select('*')
        .eq('id', planId)
        .maybeSingle();
      if (cancelled || error || !data) {
        setLoading(false);
        return;
      }
      let row: any = data;
      if (row.status === 'completed') {
        setShowRerunPrompt(true);
      } else if (row.status === 'planned' && !row.activated_at) {
        const activatedAt = new Date().toISOString();
        await supabase
          .from('night_plans')
          .update({ status: 'active', activated_at: activatedAt })
          .eq('id', planId);
        row = { ...row, status: 'active', activated_at: activatedAt };
      }
      if (!cancelled) {
        setPlan(row);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [planId]);

  // Broadcast stop changes so the map (and any other consumer) can
  // keep its rendering of activePlan fresh — arrived markers turn
  // green, skipped ones grey, etc. Fires on first load AND on every
  // subsequent stops mutation since the array reference changes.
  useEffect(() => {
    if (!plan?.stops) return;
    window.dispatchEvent(new CustomEvent('venuu-plan-sheet-stops-updated', {
      detail: {
        planId,
        stops: plan.stops,
        current_stop_index: plan.current_stop_index ?? 0,
      },
    }));
  }, [plan?.stops, plan?.current_stop_index, planId]);

  // ── Current stop = honor stored pointer if still open, else
  //     fall back to the first non-done stop. ─────────────────
  const currentStopIndex = useMemo(() => {
    if (!plan?.stops || plan.stops.length === 0) return 0;
    const stored = plan.current_stop_index;
    if (typeof stored === 'number' && stored >= 0 && stored < plan.stops.length) {
      const s = plan.stops[stored];
      if (!s?.arrived_at && !s?.visited_at && !s?.skipped_at) return stored;
    }
    for (let i = 0; i < plan.stops.length; i++) {
      const s = plan.stops[i];
      if (!s.arrived_at && !s.visited_at && !s.skipped_at) return i;
    }
    return plan.stops.length - 1;
  }, [plan]);

  // ── Display stop = focused-if-set else current. ─────────────
  const displayStopIndex = focusedStopIndex ?? currentStopIndex;
  const displayStop = plan?.stops?.[displayStopIndex] ?? null;

  // State-driven accent palette from the displayed stop's live state.
  const displayLive = displayStop?.venue_id
    ? liveByVenueId.get(displayStop.venue_id) ?? null
    : null;
  const accent = useMemo(
    () => accentForState(displayLive?.state_label ?? null),
    [displayLive],
  );

  // ── Journey-complete derivation ──────────────────────────────
  // Every stop has been either arrived at or skipped. When true:
  //   • CARD body swaps hero stop card for the "you've run the
  //     table" banner.
  //   • FULL state's end-night button gets a hero variant that
  //     pulses to draw the eye.
  const allStopsResolved = useMemo(() => {
    if (!plan?.stops || plan.stops.length === 0) return false;
    return (plan.stops as any[]).every(
      (s) => s.arrived_at || s.visited_at || s.skipped_at,
    );
  }, [plan?.stops]);
  const arrivedCount = useMemo(() => {
    if (!plan?.stops) return 0;
    return (plan.stops as any[]).filter(s => s.arrived_at || s.visited_at).length;
  }, [plan?.stops]);

  // Detect the *moment* allStopsResolved flips from false → true and
  // run the landing animation once. We wait 500ms so the arrival
  // celebration has a chance to fade — otherwise the two overlapping
  // moments fight for attention.
  useEffect(() => {
    if (allStopsResolved && !prevAllResolvedRef.current && !viewOnly) {
      const t = window.setTimeout(() => {
        setAllResolvedJustHappened(true);
        void hapticMedium();
        window.setTimeout(() => setAllResolvedJustHappened(false), 1800);
      }, 500);
      prevAllResolvedRef.current = true;
      return () => window.clearTimeout(t);
    }
    if (!allStopsResolved) {
      prevAllResolvedRef.current = false;
    }
  }, [allStopsResolved, viewOnly]);

  // ── user_visits writer + duration update on advance ─────────
  const writeUserVisit = useCallback(async (stop: any) => {
    if (!profileId) return;
    const nightOf = computeNightOf(new Date());
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from('user_visits')
      .upsert({
        user_id: profileId,
        venue_id: stop.venue_id,
        night_of: nightOf,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
        duration_min: 0,
        source: 'plan_stop',
        confidence: 100,
      }, { onConflict: 'user_id,venue_id,night_of' });
    if (!error) {
      window.dispatchEvent(new CustomEvent('venuu-visit-recorded', {
        detail: { venueId: stop.venue_id, source: 'plan_stop' },
      }));
    } else {
      console.warn('[plan-sheet] user_visits upsert failed:', error.message);
    }
  }, [profileId]);

  const updateVisitDuration = useCallback(async (prevStop: any) => {
    if (!profileId || !prevStop?.arrived_at) return;
    const nightOf = computeNightOf(new Date(prevStop.arrived_at));
    const elapsedMs = Date.now() - new Date(prevStop.arrived_at).getTime();
    const durationMin = Math.min(480, Math.max(0, Math.round(elapsedMs / 60_000)));
    await supabase
      .from('user_visits')
      .update({ last_seen_at: new Date().toISOString(), duration_min: durationMin })
      .eq('user_id', profileId)
      .eq('venue_id', prevStop.venue_id)
      .eq('night_of', nightOf);
  }, [profileId]);

  // ── Mark a stop arrived (manual = user tapped I'M HERE) ──────
  const markArrived = useCallback(async (stopIndex: number, manual: boolean = true) => {
    if (!plan?.stops) return;
    const stop = plan.stops[stopIndex];
    if (!stop || stop.arrived_at || stop.visited_at) return;

    if (manual) void hapticMedium();

    // Finalize the previous stop's duration if any.
    if (currentStopIndex > 0) {
      const prev = plan.stops[currentStopIndex - 1];
      if (prev?.arrived_at && !prev.left_at) {
        void updateVisitDuration(prev);
      }
    }

    const nowIso = new Date().toISOString();
    const updatedStops = [...plan.stops];
    updatedStops[stopIndex] = {
      ...stop,
      arrived_at: nowIso,
      confirmed_manually: manual,
    };
    const nextPointer = findNextOpenIndex(updatedStops, stopIndex + 1);

    await supabase
      .from('night_plans')
      .update({ stops: updatedStops, current_stop_index: nextPointer })
      .eq('id', plan.id);

    setPlan({ ...plan, stops: updatedStops, current_stop_index: nextPointer });
    await writeUserVisit(stop);

    setShowCelebration({ stop, index: stopIndex, accent });
    setFocusedStopIndex(null);

    // Briefly tag the just-arrived stop so its card lights up with a
    // green celebratory glow. 1200ms matches the CSS keyframe.
    setJustArrivedStopIndex(stopIndex);
    window.setTimeout(() => {
      setJustArrivedStopIndex((curr) => (curr === stopIndex ? null : curr));
    }, 1200);
  }, [plan, currentStopIndex, accent, writeUserVisit, updateVisitDuration]);

  // ── Skip a stop ──────────────────────────────────────────────
  const markSkipped = useCallback(async (stopIndex: number) => {
    if (!plan?.stops) return;
    void hapticTick();
    const updatedStops = [...plan.stops];
    updatedStops[stopIndex] = {
      ...updatedStops[stopIndex],
      skipped_at: new Date().toISOString(),
    };
    const nextPointer = findNextOpenIndex(updatedStops, stopIndex + 1);
    await supabase
      .from('night_plans')
      .update({ stops: updatedStops, current_stop_index: nextPointer })
      .eq('id', plan.id);
    setPlan({ ...plan, stops: updatedStops, current_stop_index: nextPointer });
    setFocusedStopIndex(null);
  }, [plan]);

  // ── Complete the plan → status=completed, fire event ─────────
  const completePlan = useCallback(async () => {
    if (!plan) return;
    void hapticMedium();
    const completedAt = new Date().toISOString();

    // Finalize the last visited stop's user_visits duration.
    const lastArrived = [...plan.stops].reverse().find((s: any) => s.arrived_at || s.visited_at);
    if (lastArrived) await updateVisitDuration(lastArrived);

    const finalStops = plan.stops.map((s: any) =>
      (s.arrived_at || s.visited_at) && !s.completed_at
        ? { ...s, completed_at: completedAt, left_at: s.left_at ?? completedAt }
        : s,
    );

    await supabase
      .from('night_plans')
      .update({ status: 'completed', completed_at: completedAt, stops: finalStops })
      .eq('id', plan.id);

    window.dispatchEvent(new CustomEvent('venuu-plan-completed', {
      detail: { planId: plan.id },
    }));

    // Dopamine companion event — drives the profile streak burst +
    // Plans Run stat flare. Separate from venuu-plan-completed so
    // consumers can opt into one or both without coupling concerns.
    const visitedStopsCount = (plan.stops as any[]).filter(
      s => (s.arrived_at || s.visited_at) && !s.skipped_at,
    ).length;
    window.dispatchEvent(new CustomEvent('venuu-plan-completed-celebrate', {
      detail: { planId: plan.id, visitedStopsCount },
    }));

    onPlanCompleted();
  }, [plan, onPlanCompleted, updateVisitDuration]);

  // ── Re-run a completed plan ──────────────────────────────────
  const rerunPlan = useCallback(async () => {
    if (!plan) return;
    const resetStops = plan.stops.map((s: any) => ({
      ...s,
      arrived_at: null,
      visited_at: null,
      skipped_at: null,
      completed_at: null,
      left_at: null,
      confirmed_manually: null,
    }));
    const activatedAt = new Date().toISOString();
    await supabase
      .from('night_plans')
      .update({
        status: 'active',
        activated_at: activatedAt,
        completed_at: null,
        current_stop_index: 0,
        stops: resetStops,
      })
      .eq('id', plan.id);
    setPlan({
      ...plan,
      status: 'active',
      activated_at: activatedAt,
      completed_at: null,
      current_stop_index: 0,
      stops: resetStops,
    });
    setShowRerunPrompt(false);
    setViewOnly(false);
    setFocusedStopIndex(null);
  }, [plan]);

  const viewSummary = useCallback(() => {
    setViewOnly(true);
    setShowRerunPrompt(false);
    onStateChange('full');
  }, [onStateChange]);

  // ── Sheet drag/animate ───────────────────────────────────────
  const controls = useAnimation();

  // Sync animation when sheetState changes externally (e.g. App tells
  // us to expand because the user tapped a marker on the map).
  useEffect(() => {
    controls.start({
      height: getSnapHeight(sheetState),
      transition: { type: 'spring', stiffness: 280, damping: 28, mass: 0.9 },
    });
  }, [sheetState, controls]);

  // Snap pulse — every state change fires a 600ms data-just-snapped
  // window so the CSS ::after gradient briefly draws across the top
  // of the sheet. Telegraphs the snap.
  useEffect(() => {
    setJustSnapped(true);
    const t = window.setTimeout(() => setJustSnapped(false), 600);
    return () => window.clearTimeout(t);
  }, [sheetState]);

  const handleDragEnd = useCallback((_: any, info: PanInfo) => {
    const velocity = info.velocity.y;
    const windowH = window.innerHeight;
    const currentHeight = windowH - info.point.y;

    // Velocity-based fling.
    if (Math.abs(velocity) > 500) {
      if (velocity > 0) {
        if (sheetState === 'full') onStateChange('card');
        else if (sheetState === 'card') onStateChange('pill');
        else if (sheetState === 'pill' && velocity > 1200) onDismiss();
      } else {
        if (sheetState === 'pill') onStateChange('card');
        else if (sheetState === 'card') onStateChange('full');
      }
      void hapticTick();
      return;
    }

    // Position-based snap.
    let target: PlanSheetState = 'card';
    if (currentHeight < windowH * 0.18) target = 'pill';
    else if (currentHeight < windowH * 0.74) target = 'card';
    else target = 'full';

    if (target !== sheetState) {
      onStateChange(target);
      void hapticTick();
    }
  }, [sheetState, onStateChange, onDismiss]);

  if (loading || !plan) return null;

  const accentVars = {
    ['--plan-accent' as string]: accent.primary,
    ['--plan-accent-glow' as string]: accent.glow,
    ['--plan-accent-glow-dim' as string]: accent.glowDim,
    ['--plan-accent-fluid' as string]: accent.fluid,
    ['--plan-accent-label' as string]: accent.label,
  } as React.CSSProperties;

  // ─── PILL state — slim bar at the top of the map ────────────
  if (sheetState === 'pill') {
    return (
      <motion.div
        className="plan-sheet plan-sheet--pill"
        data-state="pill"
        data-dragging={isDragging || undefined}
        data-just-snapped={justSnapped || undefined}
        style={accentVars}
        animate={controls}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.2}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={(e, info) => { setIsDragging(false); handleDragEnd(e, info); }}
        onClick={() => { void hapticLight(); onStateChange('card'); }}
      >
        <div className="plan-sheet__pill-content">
          <div className="plan-sheet__pill-dots">
            {plan.stops.map((s: any, idx: number) => {
              const variant = s.arrived_at || s.visited_at
                ? 'arrived'
                : s.skipped_at
                  ? 'skipped'
                  : idx === currentStopIndex
                    ? 'current'
                    : '';
              return (
                <div
                  key={idx}
                  className={`plan-sheet__pill-dot${variant ? ` plan-sheet__pill-dot--${variant}` : ''}`}
                />
              );
            })}
          </div>
          <div className="plan-sheet__pill-title">{plan.title}</div>
          <div className="plan-sheet__pill-meta">
            stop {currentStopIndex + 1} of {plan.stops.length}
          </div>
        </div>
      </motion.div>
    );
  }

  // ─── CARD + FULL states ─────────────────────────────────────
  return (
    <>
      <motion.div
        className="plan-sheet"
        data-state={sheetState}
        data-dragging={isDragging || undefined}
        data-just-snapped={justSnapped || undefined}
        style={accentVars}
        animate={controls}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.15}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={(e, info) => { setIsDragging(false); handleDragEnd(e, info); }}
      >
        <div
          className="plan-sheet__handle"
          onClick={() => {
            void hapticLight();
            onStateChange(sheetState === 'card' ? 'full' : 'card');
          }}
        />

        <div className="plan-sheet__header">
          <div className="plan-sheet__header-title">
            <div className="plan-sheet__header-name">{plan.title}</div>
            <div className="plan-sheet__header-meta">
              {viewOnly ? (
                <>
                  <span className="plan-sheet__viewing-badge">VIEWING PAST RUN</span>
                  {plan.completed_at && (
                    <>{' · '}ran {new Date(plan.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>
                  )}
                </>
              ) : (
                <>stop {currentStopIndex + 1} of {plan.stops.length}</>
              )}
            </div>
          </div>
          {viewOnly ? (
            <button
              type="button"
              className="plan-sheet__close-pill"
              onClick={() => { void hapticLight(); onDismiss(); }}
            >
              <X size={14} />
              <span>close</span>
            </button>
          ) : (
            <button
              type="button"
              className="plan-sheet__close"
              onClick={() => { void hapticLight(); onDismiss(); }}
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {sheetState === 'card' && (
          <div className="plan-sheet__card-body">
            {viewOnly && plan.status === 'completed' && plan.rating_status !== 'rated' && (
              <button
                type="button"
                className="rate-prompt-button"
                onClick={() => { void hapticMedium(); setShowRateFlow(true); }}
              >
                <Sparkles size={16} aria-hidden />
                rate this night → make venny smarter
              </button>
            )}
            {allStopsResolved && !viewOnly ? (
              // Every stop is either arrived or skipped — swap the
              // hero card for a journey-complete banner that nudges
              // the user toward "end the night". On the moment of
              // resolution (not on subsequent renders) the banner
              // gets a slide-up + weight-flare landing animation.
              <div
                className={
                  'plan-sheet__complete-banner' +
                  (allResolvedJustHappened ? ' plan-sheet__complete-banner--landing' : '')
                }
              >
                <div className="plan-sheet__complete-glow" aria-hidden />
                <h2
                  className="plan-sheet__complete-title weight-choreograph"
                  data-state="settled"
                >
                  you've run the table
                </h2>
                <div className="plan-sheet__complete-meta">
                  {arrivedCount} {arrivedCount === 1 ? 'stop' : 'stops'} visited · ready to close out the night?
                </div>
                <button
                  type="button"
                  className="action-here plan-sheet__complete-cta"
                  onClick={() => { void completePlan(); }}
                >
                  <span className="action-here__fluid" aria-hidden />
                  <span className="action-here__label">end the night</span>
                </button>
              </div>
            ) : displayStop ? (
              <StopCard
                stop={displayStop}
                index={displayStopIndex}
                totalStops={plan.stops.length}
                state={
                  displayStop.arrived_at || displayStop.visited_at
                    ? 'arrived'
                    : displayStop.skipped_at
                      ? 'skipped'
                      : displayStopIndex === currentStopIndex
                        ? 'current'
                        : 'upcoming'
                }
                live={displayLive}
                distanceMeters={null}
                isPulsing={false}
                viewOnly={viewOnly}
                justArrived={justArrivedStopIndex === displayStopIndex}
                onMarkHere={() => markArrived(displayStopIndex, true)}
                onSkip={() => markSkipped(displayStopIndex)}
                onGetDirections={() => {
                  void hapticLight();
                  openDirectionsTo(displayStop.lat, displayStop.lng, displayStop.venue_name, displayStop.venue_id);
                }}
              />
            ) : null}

            <div className="plan-sheet__progress">
              {plan.stops.map((s: any, idx: number) => {
                const isFocused = idx === displayStopIndex;
                const variant = s.arrived_at || s.visited_at
                  ? 'arrived'
                  : s.skipped_at
                    ? 'skipped'
                    : idx === currentStopIndex
                      ? 'current'
                      : '';
                return (
                  <button
                    key={idx}
                    type="button"
                    className={`plan-sheet__progress-stop${isFocused ? ' plan-sheet__progress-stop--focused' : ''}`}
                    onClick={() => {
                      void hapticLight();
                      setFocusedStopIndex(idx);
                      onFocusStopChange(idx);
                    }}
                  >
                    <div className={`plan-sheet__progress-dot${variant ? ` plan-sheet__progress-dot--${variant}` : ''}`} />
                    <div className="plan-sheet__progress-name">{s.venue_name}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {sheetState === 'full' && (
          <>
            <div className="plan-sheet__full-body">
              {viewOnly && plan.status === 'completed' && plan.rating_status !== 'rated' && (
                <button
                  type="button"
                  className="rate-prompt-button"
                  onClick={() => { void hapticMedium(); setShowRateFlow(true); }}
                >
                  <Sparkles size={16} aria-hidden />
                  rate this night → make venny smarter
                </button>
              )}
              {plan.stops.map((s: any, idx: number) => {
                const state =
                  s.arrived_at || s.visited_at
                    ? 'arrived'
                    : s.skipped_at
                      ? 'skipped'
                      : idx === currentStopIndex
                        ? 'current'
                        : 'upcoming';
                const live = liveByVenueId.get(s.venue_id) ?? null;
                return (
                  <StopCard
                    key={idx}
                    stop={s}
                    index={idx}
                    totalStops={plan.stops.length}
                    state={state}
                    live={live}
                    distanceMeters={null}
                    isPulsing={false}
                    viewOnly={viewOnly}
                    justArrived={justArrivedStopIndex === idx}
                    onMarkHere={() => markArrived(idx, true)}
                    onSkip={() => markSkipped(idx)}
                    onGetDirections={() => {
                      void hapticLight();
                      openDirectionsTo(s.lat, s.lng, s.venue_name, s.venue_id);
                    }}
                  />
                );
              })}
            </div>

            {viewOnly ? (
              <div className="plan-sheet__end-button-wrapper">
                <button
                  type="button"
                  className="plan-sheet__close-summary-button"
                  onClick={() => { void hapticLight(); onDismiss(); }}
                >
                  close summary
                </button>
              </div>
            ) : (
              <div className="plan-sheet__end-button-wrapper">
                <button
                  type="button"
                  className={
                    'plan-sheet__end-button' +
                    (allStopsResolved ? ' plan-sheet__end-button--hero' : '')
                  }
                  onClick={() => { void completePlan(); }}
                >
                  end the night
                </button>
              </div>
            )}
          </>
        )}
      </motion.div>

      {/* Arrival celebration — fires above sheet AND map. */}
      {showCelebration && (
        <ArrivalCelebration
          venueName={showCelebration.stop.venue_name}
          stopNumber={showCelebration.index + 1}
          stateLabel={displayLive?.state_label ?? null}
          accent={showCelebration.accent}
          onComplete={() => setShowCelebration(null)}
        />
      )}

      {/* Rate Night flow — mounted at z-index 320 over the sheet.
       *  Triggered by the "rate this night → make Venny smarter"
       *  prompt visible on view-only completed-but-unrated plans.
       *  We refetch the plan on close so rating_status flips from
       *  'unrated' → 'rated' and the prompt disappears. */}
      {showRateFlow && (
        <RateNightFlow
          planId={planId}
          onComplete={() => {
            setShowRateFlow(false);
            // Reflect rating_status locally so the prompt button
            // vanishes immediately — the DB write already happened
            // inside the flow's submitRatings.
            setPlan((prev: any) => prev ? { ...prev, rating_status: 'rated' } : prev);
          }}
          onSkip={() => { setShowRateFlow(false); }}
        />
      )}

      {/* Re-run prompt — shown when the user opens a completed plan. */}
      {showRerunPrompt && (
        <div className="rerun-prompt-backdrop" role="dialog" aria-modal="true">
          <div className="rerun-prompt-card">
            <div className="rerun-prompt__title">this plan is completed</div>
            <div className="rerun-prompt__date">
              {plan.completed_at
                ? `completed ${new Date(plan.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                : 'completed'}
            </div>
            <button
              type="button"
              className="action-here rerun-prompt__primary"
              onClick={() => { void rerunPlan(); }}
            >
              <span className="action-here__fluid" aria-hidden />
              <span className="action-here__label">run it again</span>
            </button>
            <button
              type="button"
              className="rerun-prompt__ghost"
              onClick={viewSummary}
            >
              just view summary
            </button>
          </div>
        </div>
      )}
    </>
  );
}
