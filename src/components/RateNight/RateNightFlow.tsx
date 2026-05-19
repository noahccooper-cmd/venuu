// deno-lint-ignore-file no-explicit-any
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { X, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { hapticLight, hapticMedium, hapticSuccess } from '../../lib/haptics';

/**
 * RateNightFlow — five-step rating flow that fires from the
 * End-Night Ceremony when the user taps "rate this night," and
 * from the PlanSheet's view-only "rate this night → make Venny
 * smarter" prompt on any completed-but-unrated plan.
 *
 *   Step 0 — per-stop swipe rating (loved / fine / meh).
 *            Drag the card right → loved, left → meh, down → fine.
 *            Three action buttons below cover users who don't
 *            discover the gesture.
 *   Step 1 — overall night rating. Five vertical buttons. Tap
 *            one and the flow auto-advances 400ms later.
 *   Step 2 — optional mood tags. Multi-select pills with skip.
 *   Step 3 — optional "would you repeat?" — two big buttons + skip.
 *   Step 4 — done. Submits to Supabase on mount, fires
 *            venuu-night-rated, auto-dismisses after 2.4s OR on
 *            "back to map" tap.
 *
 * The flow lives at z-index 320, ABOVE the ceremony (z-index 300),
 * so when it mounts the ceremony stays behind it visually but is
 * invisible due to opacity transitions. On Complete/Skip the
 * ceremony continues its own dismiss choreography.
 */

interface RateNightFlowProps {
  planId: string;
  onComplete: () => void;
  /** Called when the user bails out of the flow without finishing.
   *  The parent (EndNightCeremony / PlanSheet) is responsible for
   *  flagging the plan as 'pending_morning' so the morning push
   *  cron can re-prompt later. */
  onSkip: () => void;
}

type StopRating = 'loved' | 'fine' | 'meh';

const SWIPE_THRESHOLD = 80;
const STEP_STOPS = 0;
const STEP_OVERALL = 1;
const STEP_MOOD = 2;
const STEP_REPEAT = 3;
const STEP_DONE = 4;
const DONE_AUTO_DISMISS_MS = 2400;

const OVERALL_OPTIONS: Array<{ id: string; emoji: string; label: string; desc: string }> = [
  { id: 'best_in_weeks', emoji: '🔥', label: 'best in weeks', desc: 'unforgettable' },
  { id: 'great',         emoji: '✨', label: 'great',         desc: 'real time' },
  { id: 'good',          emoji: '👍', label: 'good',          desc: 'it was nice' },
  { id: 'meh',           emoji: '😐', label: 'meh',           desc: 'it was fine' },
  { id: 'bad',           emoji: '💀', label: 'not it',        desc: 'missed' },
];

const MOOD_TAGS: Array<{ id: string; label: string }> = [
  { id: 'chill',      label: 'chill' },
  { id: 'hype',       label: 'hype' },
  { id: 'social',     label: 'social' },
  { id: 'romantic',   label: 'romantic' },
  { id: 'rowdy',      label: 'rowdy' },
  { id: 'deep_talks', label: 'deep talks' },
  { id: 'dancing',    label: 'dancing' },
  { id: 'weird',      label: 'weird' },
  { id: 'low_key',    label: 'low key' },
];

export function RateNightFlow({ planId, onComplete, onSkip }: RateNightFlowProps) {
  const [plan, setPlan] = useState<any | null>(null);
  const [step, setStep] = useState(STEP_STOPS);
  const [currentStopRatingIndex, setCurrentStopRatingIndex] = useState(0);
  const [stopRatings, setStopRatings] = useState<Record<number, StopRating>>({});
  const [overallRating, setOverallRating] = useState<string | null>(null);
  const [overallSelecting, setOverallSelecting] = useState<string | null>(null);
  const [moodTags, setMoodTags] = useState<string[]>([]);
  const [wouldRepeat, setWouldRepeat] = useState<boolean | null>(null);
  const [exitDirection, setExitDirection] = useState<'left' | 'right' | 'down' | null>(null);
  // Live drag direction — feeds data-direction on the swipe card so
  // CSS can tint the border in real time as the user pulls.
  const [dragDirection, setDragDirection] = useState<'left' | 'right' | 'down' | null>(null);
  const submittedRef = useRef(false);

  // ── Load plan on mount ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('night_plans')
        .select('*')
        .eq('id', planId)
        .maybeSingle();
      if (cancelled || error || !data) return;
      setPlan(data);
    })();
    return () => { cancelled = true; };
  }, [planId]);

  // Only stops the user actually arrived at (skipped + never-arrived
  // don't get rated). The originalIndex preserves the JSONB position
  // so the upsert keys cleanly to night_plans.stops[i].
  const ratedStops = useMemo<Array<any & { originalIndex: number }>>(() => {
    if (!plan?.stops) return [];
    return (plan.stops as any[])
      .map((s, idx) => ({ ...s, originalIndex: idx }))
      .filter(s => (s.arrived_at || s.visited_at) && !s.skipped_at);
  }, [plan]);

  // Progress dots — 4 user-facing steps (stops/overall/mood/repeat).
  // Step DONE has no dot since it's the destination.
  const progressDotState = (idx: number): 'inactive' | 'active' | 'complete' => {
    if (step > idx) return 'complete';
    if (step === idx) return 'active';
    return 'inactive';
  };

  // ── Step 0: per-stop swipe ratings ───────────────────────────
  const currentStop = ratedStops[currentStopRatingIndex];

  const advanceFromStops = useCallback(() => {
    if (currentStopRatingIndex < ratedStops.length - 1) {
      setCurrentStopRatingIndex(i => i + 1);
      setExitDirection(null);
    } else {
      setStep(STEP_OVERALL);
      setExitDirection(null);
    }
  }, [currentStopRatingIndex, ratedStops.length]);

  const handleRate = useCallback((rating: StopRating, direction: 'left' | 'right' | 'down' = 'down') => {
    if (!currentStop) return;
    void hapticLight();
    setStopRatings(prev => ({ ...prev, [currentStop.originalIndex]: rating }));
    setExitDirection(direction);
    // Wait for the exit animation (320ms) before mounting the next card.
    window.setTimeout(advanceFromStops, 320);
  }, [currentStop, advanceFromStops]);

  const handleDragEnd = useCallback((_: any, info: PanInfo) => {
    const { x, y } = info.offset;
    if (Math.abs(x) > Math.abs(y)) {
      if (x > SWIPE_THRESHOLD) return handleRate('loved', 'right');
      if (x < -SWIPE_THRESHOLD) return handleRate('meh', 'left');
    } else if (y > SWIPE_THRESHOLD) {
      return handleRate('fine', 'down');
    }
    // Below threshold — framer-motion springs the card back to center
    // automatically because we use animate={{ x: 0, y: 0 }} as the
    // settled state below.
  }, [handleRate]);

  // ── Step 1: overall rating ───────────────────────────────────
  const handlePickOverall = useCallback((id: string) => {
    void hapticMedium();
    setOverallRating(id);
    setOverallSelecting(id);
    window.setTimeout(() => {
      setStep(STEP_MOOD);
      setOverallSelecting(null);
    }, 400);
  }, []);

  // ── Step 2: mood tags ────────────────────────────────────────
  const toggleMood = useCallback((id: string) => {
    void hapticLight();
    setMoodTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  }, []);

  // ── Step 3: would repeat ─────────────────────────────────────
  const handleRepeat = useCallback((answer: boolean | null) => {
    if (answer !== null) void hapticLight();
    setWouldRepeat(answer);
    setStep(STEP_DONE);
  }, []);

  // ── Step 4: submit + auto-dismiss ────────────────────────────
  const submitRatings = useCallback(async () => {
    if (!plan || submittedRef.current) return;
    submittedRef.current = true;
    const userId: string = plan.user_id;

    // Stop ratings batch (skip stops the user didn't rate — happens
    // if they bailed mid-stops via the close X, in which case onSkip
    // fires and we never reach here).
    const stopRows = Object.entries(stopRatings).map(([stopIdx, rating]) => {
      const stop = plan.stops[parseInt(stopIdx, 10)];
      return {
        user_id: userId,
        plan_id: plan.id,
        stop_index: parseInt(stopIdx, 10),
        venue_id: stop.venue_id,
        rating,
      };
    });
    if (stopRows.length > 0) {
      const { error: stopErr } = await supabase
        .from('stop_ratings')
        .upsert(stopRows, { onConflict: 'user_id,plan_id,stop_index' });
      if (stopErr) console.warn('[rate-night] stop_ratings upsert failed:', stopErr.message);
    }

    // Night rating (only if user actually picked an overall).
    if (overallRating) {
      const { error: nightErr } = await supabase
        .from('night_ratings')
        .upsert({
          user_id: userId,
          plan_id: plan.id,
          overall_rating: overallRating,
          mood_tags: moodTags,
          would_repeat: wouldRepeat,
        }, { onConflict: 'plan_id' });
      if (nightErr) console.warn('[rate-night] night_ratings upsert failed:', nightErr.message);
    }

    // Mark plan as rated so the morning-push cron skips it.
    const { error: planErr } = await supabase
      .from('night_plans')
      .update({ rating_status: 'rated' })
      .eq('id', plan.id);
    if (planErr) console.warn('[rate-night] rating_status update failed:', planErr.message);

    // Profile + Venny memory listeners pick this up.
    window.dispatchEvent(new CustomEvent('venuu-night-rated', {
      detail: {
        planId: plan.id,
        overallRating,
        stopRatingsCount: stopRows.length,
      },
    }));

    void hapticSuccess();
  }, [plan, stopRatings, overallRating, moodTags, wouldRepeat]);

  // Fire submission exactly once when we land on DONE.
  useEffect(() => {
    if (step === STEP_DONE) void submitRatings();
  }, [step, submitRatings]);

  // Auto-dismiss after the done animation lands.
  useEffect(() => {
    if (step !== STEP_DONE) return;
    const t = window.setTimeout(onComplete, DONE_AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [step, onComplete]);

  // ── Stop card meta helpers ───────────────────────────────────
  function stopDurationLabel(stop: any): string {
    const arrived = stop?.arrived_at || stop?.visited_at;
    const left = stop?.left_at || stop?.completed_at;
    if (!arrived) return '';
    const startMs = Date.parse(arrived);
    const endMs = left ? Date.parse(left) : Date.now();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return '';
    const mins = Math.round((endMs - startMs) / 60_000);
    return `${mins} min`;
  }
  function stopWindowLabel(stop: any): string {
    const arrived = stop?.arrived_at || stop?.visited_at;
    const left = stop?.left_at || stop?.completed_at;
    if (!arrived) return '';
    try {
      const a = new Date(arrived).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const l = left ? new Date(left).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
      return l ? `${a} – ${l}` : a;
    } catch { return ''; }
  }

  // Loading guard — flow renders nothing until the plan loads.
  if (!plan) return null;

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="rate-night-flow" role="dialog" aria-modal="true">
      {/* Top row — close + 4-step progress strip. Sits below the
       *  safe-area inset so the notch / status bar stay clear. */}
      <div className="rate-night-flow__top">
        <button
          type="button"
          className="rate-night-flow__close"
          onClick={() => { void hapticLight(); onSkip(); }}
          aria-label="Close rating"
        >
          <X size={16} />
        </button>
        {step < STEP_DONE ? (
          <div className="rate-night-flow__progress" aria-hidden>
            {[STEP_STOPS, STEP_OVERALL, STEP_MOOD, STEP_REPEAT].map(s => (
              <span
                key={s}
                className={`rate-night-flow__progress-dot rate-night-flow__progress-dot--${progressDotState(s)}`}
              />
            ))}
          </div>
        ) : (
          // On DONE step the progress row is hidden but we keep an
          // empty flex spacer so the close X stays right-aligned.
          <div className="rate-night-flow__progress" aria-hidden />
        )}
      </div>

      {/* Body — vertically centered between top row and footer. */}
      <div className="rate-night-flow__body">

      {/* STEP 0 — per-stop swipe ratings */}
      {step === STEP_STOPS && ratedStops.length > 0 && currentStop && (
        <>
          <div className="rate-night-flow__step-header">
            <div className="rate-night-flow__step-meta">
              rating {currentStopRatingIndex + 1} of {ratedStops.length}
            </div>
            <div className="rate-night-flow__step-title">how was this stop?</div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={currentStop.originalIndex}
              className="rate-stop-card"
              data-direction={dragDirection ?? undefined}
              drag
              dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
              dragElastic={0.6}
              onDrag={(_, info) => {
                // Live-tint the border based on drag offset. Threshold
                // 60px keeps tiny accidental wiggles from flickering.
                const { x, y } = info.offset;
                if (Math.abs(x) < 20 && Math.abs(y) < 20) {
                  setDragDirection(null);
                  return;
                }
                if (y > 60 && Math.abs(x) < y) setDragDirection('down');
                else if (x > 60) setDragDirection('right');
                else if (x < -60) setDragDirection('left');
                else setDragDirection(null);
              }}
              onDragEnd={(e, info) => {
                setDragDirection(null);
                handleDragEnd(e, info);
              }}
              initial={{ opacity: 0, y: 40, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1, x: 0 }}
              exit={
                exitDirection === 'right'
                  ? { x: 420, opacity: 0, rotate: 8 }
                  : exitDirection === 'left'
                    ? { x: -420, opacity: 0, rotate: -8 }
                    : { y: 320, opacity: 0 }
              }
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              whileDrag={{ rotate: 0, cursor: 'grabbing' }}
            >
              <div className="rate-stop-card__name">{currentStop.venue_name}</div>
              <div className="rate-stop-card__meta">
                stop {currentStop.originalIndex + 1}
                {stopWindowLabel(currentStop) ? ` · ${stopWindowLabel(currentStop)}` : ''}
              </div>
              {stopDurationLabel(currentStop) && (
                <div className="rate-stop-card__duration">stayed {stopDurationLabel(currentStop)}</div>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="rate-actions">
            <button
              type="button"
              className="rate-action rate-action--meh"
              onClick={() => handleRate('meh', 'left')}
            >
              <span className="rate-action__icon" aria-hidden>✗</span>
              <span className="rate-action__label">meh</span>
            </button>
            <button
              type="button"
              className="rate-action rate-action--fine"
              onClick={() => handleRate('fine', 'down')}
            >
              <span className="rate-action__icon" aria-hidden>➖</span>
              <span className="rate-action__label">fine</span>
            </button>
            <button
              type="button"
              className="rate-action rate-action--loved"
              onClick={() => handleRate('loved', 'right')}
            >
              <span className="rate-action__icon" aria-hidden>❤</span>
              <span className="rate-action__label">loved</span>
            </button>
          </div>
        </>
      )}

      {/* Edge case — no arrived stops (every stop was skipped). Jump
          directly to overall rating; the user can still rate the night. */}
      {step === STEP_STOPS && ratedStops.length === 0 && (() => {
        // Fire once on first render — synchronous setState in render
        // would warn, so defer to next tick.
        queueMicrotask(() => setStep(STEP_OVERALL));
        return null;
      })()}

      {/* STEP 1 — overall night rating */}
      {step === STEP_OVERALL && (
        <>
          <div className="rate-night-flow__step-header">
            <div className="rate-night-flow__step-meta">step 2 of 4</div>
            <div className="rate-night-flow__step-title">how was the night?</div>
          </div>
          <div className="rate-overall-options">
            {OVERALL_OPTIONS.map(opt => (
              <button
                key={opt.id}
                type="button"
                data-rating={opt.id}
                className={
                  'rate-overall-option' +
                  (overallSelecting === opt.id ? ' rate-overall-option--selecting' : '')
                }
                onClick={() => handlePickOverall(opt.id)}
              >
                <span className="rate-overall-option__emoji" aria-hidden>{opt.emoji}</span>
                <span className="rate-overall-option__text">
                  <div className="rate-overall-option__label">{opt.label}</div>
                  <div className="rate-overall-option__desc">{opt.desc}</div>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* STEP 2 — mood tags */}
      {step === STEP_MOOD && (
        <>
          <div className="rate-night-flow__step-header">
            <div className="rate-night-flow__step-meta">step 3 of 4 · optional</div>
            <div className="rate-night-flow__step-title">what was the vibe?</div>
          </div>
          <div className="rate-mood-grid">
            {MOOD_TAGS.map(tag => {
              const selected = moodTags.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  className={'rate-mood-tag' + (selected ? ' rate-mood-tag--selected' : '')}
                  onClick={() => toggleMood(tag.id)}
                  aria-pressed={selected}
                >
                  {tag.label}
                </button>
              );
            })}
          </div>
          <div className="rate-footer">
            <button
              type="button"
              className="rate-skip-button"
              onClick={() => {
                void hapticLight();
                setMoodTags([]);
                setStep(STEP_REPEAT);
              }}
            >
              skip
            </button>
            <button
              type="button"
              className="rate-continue-button"
              onClick={() => { void hapticMedium(); setStep(STEP_REPEAT); }}
            >
              continue
            </button>
          </div>
        </>
      )}

      {/* STEP 3 — would repeat */}
      {step === STEP_REPEAT && (
        <>
          <div className="rate-night-flow__step-header">
            <div className="rate-night-flow__step-meta">step 4 of 4 · optional</div>
            <div className="rate-night-flow__step-title">would you run it again?</div>
          </div>
          <div className="rate-repeat-options">
            <button
              type="button"
              className="rate-repeat-option rate-repeat-option--yes"
              onClick={() => handleRepeat(true)}
            >
              yes — run this back
            </button>
            <button
              type="button"
              className="rate-repeat-option rate-repeat-option--no"
              onClick={() => handleRepeat(false)}
            >
              nah — one and done
            </button>
          </div>
          <div className="rate-footer">
            <button
              type="button"
              className="rate-skip-button"
              onClick={() => handleRepeat(null)}
            >
              skip
            </button>
          </div>
        </>
      )}

      {/* STEP 4 — done */}
      {step === STEP_DONE && (
        <div className="rate-done">
          <div className="rate-done__check">
            <Check strokeWidth={3} />
          </div>
          <div className="rate-done__title">thanks for rating</div>
          <div className="rate-done__subtitle">venny just got smarter</div>
          <div className="rate-done__cta">
            <button
              type="button"
              className="rate-continue-button"
              onClick={() => { void hapticLight(); onComplete(); }}
            >
              back to map
            </button>
          </div>
        </div>
      )}
      </div>{/* /.rate-night-flow__body */}
    </div>
  );
}
