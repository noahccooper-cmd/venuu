import { useCallback, useEffect, useRef, useState } from 'react';
import type { CityKey } from '../lib/constants';

/**
 * useColdOpen — phase state machine for the cinematic intro.
 *
 * Decides full vs shortened mode based on a localStorage timestamp,
 * advances through the named phases on a setTimeout schedule, pauses
 * cleanly on tab visibility hide, and exposes skip + complete callbacks
 * the CinematicIntro component drives off of.
 *
 * Spec: Prompt 16B.
 */

export type ColdOpenPhase =
  | 'inactive'        // intro is off
  | 'logo'            // Phase 1
  | 'globe-emerge'    // Phase 2
  | 'constellation'   // Phase 3
  | 'identify'        // Phase 4
  | 'descent'         // Phase 5
  | 'bubble-bloom'    // Phase 6
  | 'done';           // Phase 7 (transient — caller drains via complete())

export type ColdOpenMode = 'full' | 'shortened' | 'skipped';

export interface UseColdOpenReturn {
  phase: ColdOpenPhase;
  mode: ColdOpenMode;
  active: boolean;
  skip: () => void;
  complete: () => void;
}

interface UseColdOpenOpts {
  /** When false the hook does nothing — sits at 'inactive'. */
  enabled: boolean;
  /** City the descent + identify phases will target. */
  targetCity: CityKey;
}

interface PhaseSpec {
  name: ColdOpenPhase;
  startMs: number;
  endMs: number;
}

const FULL_PHASES: PhaseSpec[] = [
  { name: 'logo',          startMs: 0,    endMs: 1200 },
  { name: 'globe-emerge',  startMs: 1200, endMs: 2800 },
  { name: 'constellation', startMs: 2800, endMs: 4800 },
  { name: 'identify',      startMs: 4800, endMs: 6000 },
  { name: 'descent',       startMs: 6000, endMs: 8600 },
  { name: 'bubble-bloom',  startMs: 8600, endMs: 9600 },
  { name: 'done',          startMs: 9600, endMs: Number.POSITIVE_INFINITY },
];

const SHORTENED_PHASES: PhaseSpec[] = [
  { name: 'globe-emerge',  startMs: 0,    endMs: 400 },
  { name: 'constellation', startMs: 400,  endMs: 600 },
  { name: 'descent',       startMs: 600,  endMs: 1500 },
  { name: 'done',          startMs: 1500, endMs: Number.POSITIVE_INFINITY },
];

const STORAGE_KEY = 'venuu_intro_last_seen';
const ENABLED_KEY = 'venuu_intro_enabled';
const SHORTENED_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7d → full intro again

function pickMode(): ColdOpenMode {
  try {
    // User disabled the intro from Settings → render nothing.
    const enabled = localStorage.getItem(ENABLED_KEY);
    if (enabled === 'false') return 'skipped';

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 'full';
    const last = Number(raw);
    if (!Number.isFinite(last)) return 'full';
    const elapsed = Date.now() - last;
    if (elapsed > SHORTENED_THRESHOLD_MS) return 'full';
    return 'shortened';
  } catch {
    return 'full';
  }
}

function phaseAtElapsed(specs: PhaseSpec[], elapsed: number): ColdOpenPhase {
  for (const p of specs) {
    if (elapsed < p.endMs) return p.name;
  }
  return specs[specs.length - 1].name;
}

export function useColdOpen({ enabled, targetCity: _targetCity }: UseColdOpenOpts): UseColdOpenReturn {
  // Mode is captured once per intro run. `null` until the first activation
  // so we don't paint anything before the localStorage read settles.
  const [phase, setPhase] = useState<ColdOpenPhase>('inactive');
  const [mode, setMode] = useState<ColdOpenMode>('full');

  // Wall-clock anchor for the active intro. Adjusted by visibility pauses
  // so elapsed math always refers to "time the user actually saw."
  const startTimeRef = useRef<number | null>(null);
  const pausedAtRef = useRef<number | null>(null);
  const specsRef = useRef<PhaseSpec[]>(FULL_PHASES);
  const timeoutRef = useRef<number | null>(null);
  const startedRef = useRef(false);

  const clearPending = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const scheduleNext = useCallback(() => {
    if (startTimeRef.current === null) return;
    const elapsed = Date.now() - startTimeRef.current;
    const specs = specsRef.current;
    // Find the spec whose endMs is greater than elapsed — that's the one
    // we're currently in; the boundary we'll fire at is its endMs.
    const idx = specs.findIndex(p => elapsed < p.endMs);
    if (idx < 0) return;
    const current = specs[idx];
    setPhase(current.name);
    if (current.name === 'done') return;
    const next = specs[idx + 1];
    if (!next) return;
    const wait = Math.max(0, next.startMs - elapsed);
    clearPending();
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      scheduleNext();
    }, wait);
  }, [clearPending]);

  // Boot: when enabled flips true, choose mode + start the schedule.
  useEffect(() => {
    if (!enabled) {
      // Tear down any active intro if the parent disables us mid-run.
      clearPending();
      startTimeRef.current = null;
      pausedAtRef.current = null;
      startedRef.current = false;
      setPhase('inactive');
      return;
    }
    if (startedRef.current) return; // already running
    startedRef.current = true;

    const chosenMode = pickMode();
    setMode(chosenMode);
    if (chosenMode === 'skipped') {
      // User disabled the intro — sit at 'inactive', never schedule.
      setPhase('inactive');
      return;
    }
    specsRef.current = chosenMode === 'full' ? FULL_PHASES : SHORTENED_PHASES;
    startTimeRef.current = Date.now();
    setPhase(specsRef.current[0].name);
    scheduleNext();

    return () => {
      // Effect cleanup — only fires on unmount or enabled flipping false.
      clearPending();
    };
  }, [enabled, scheduleNext, clearPending]);

  // Visibility pause: clear timeouts on hide, recompute + reschedule on show.
  useEffect(() => {
    if (!enabled) return;
    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        if (startTimeRef.current !== null) {
          pausedAtRef.current = Date.now();
          clearPending();
        }
      } else {
        if (pausedAtRef.current !== null && startTimeRef.current !== null) {
          const pauseDuration = Date.now() - pausedAtRef.current;
          startTimeRef.current += pauseDuration;
          pausedAtRef.current = null;
          // Recompute current phase at the now-shifted elapsed mark and
          // schedule the next boundary.
          const elapsed = Date.now() - startTimeRef.current;
          setPhase(phaseAtElapsed(specsRef.current, elapsed));
          scheduleNext();
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [enabled, scheduleNext, clearPending]);

  const skip = useCallback(() => {
    clearPending();
    setMode('skipped');
    setPhase('done');
    // Small beat so the parent has time to bind the camera target before
    // CinematicIntro's exit choreography runs.
    window.setTimeout(() => {
      // No-op here; the parent calls complete() on its own once it sees
      // phase === 'done'. Leaving this scheduled so any consumers waiting
      // on the microtask boundary get a render in between.
    }, 50);
  }, [clearPending]);

  const complete = useCallback(() => {
    clearPending();
    setPhase('inactive');
    startedRef.current = false;
    startTimeRef.current = null;
    pausedAtRef.current = null;
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // localStorage may be unavailable (private mode); intro just won't
      // shorten on next launch — acceptable.
    }
  }, [clearPending]);

  const active = phase !== 'inactive' && phase !== 'done';

  return { phase, mode, active, skip, complete };
}
