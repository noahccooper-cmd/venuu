// deno-lint-ignore-file no-explicit-any
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { AnimatedCounter } from './AnimatedCounter';
import { accentForState, type StateAccent } from '../../lib/planExecutionTokens';
import { hapticHeavy, hapticMedium, hapticLight } from '../../lib/haptics';
import { RateNightFlow } from '../RateNight/RateNightFlow';

/**
 * EndNightCeremony — full-screen wrap-up moment.
 *
 * Replaces the modal-card EndNightModal with a typography-led
 * ceremony. Hero text choreographs from "settling" → "settled",
 * three stat counters fade in staggered (1.0s / 1.3s / 1.6s),
 * constellation draws + dots pop after 2.2s, CTAs land at 4.5s.
 * Auto-dismisses after 12s if nothing tapped (then routes to the
 * "rate it later" path).
 *
 * Tint is driven by the dominant live state across visited stops:
 * a Surging-heavy night reads ember, a Quiet-heavy one reads cool.
 */

interface EndNightCeremonyProps {
  planId: string;
  /** Optional state lookup keyed on venue_id so we can compute the
   *  ceremony tint from the dominant visited state. */
  liveByVenueId?: Map<string, { state_label: string | null }>;
  onComplete: () => void;
}

const AUTO_DISMISS_MS = 12_000;

export function EndNightCeremony({
  planId,
  liveByVenueId,
  onComplete,
}: EndNightCeremonyProps) {
  const [plan, setPlan] = useState<any | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  // When true, mount the RateNightFlow over the ceremony. The
  // ceremony stays in the DOM behind it (z-index 300 < 320) but
  // backdrop blur + opacity make it disappear visually.
  const [showRateFlow, setShowRateFlow] = useState(false);

  // ── Load the completed plan + drop the entry haptic. ─────────
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
      void hapticHeavy();
    })();
    return () => { cancelled = true; };
  }, [planId]);

  // ── UI isolation: mark the body while the ceremony is mounted
  //    so other floating surfaces (Venny pill, Drop pill, plan
  //    sheet, map controls) get hidden by global CSS. The ceremony
  //    is THE moment — no other UI competes for attention.
  useEffect(() => {
    document.body.setAttribute('data-ceremony-active', 'true');
    return () => { document.body.removeAttribute('data-ceremony-active'); };
  }, []);

  // ── Stats: visited count · elapsed minutes · estimated spend. ─
  const stats = useMemo(() => {
    if (!plan?.stops) return null;
    const visited = plan.stops.filter(
      (s: any) => (s.arrived_at || s.visited_at) && !s.skipped_at,
    );
    const totalSpent = visited.reduce(
      (sum: number, s: any) => sum + (typeof s.estimated_cost === 'number' ? s.estimated_cost : 0),
      0,
    );
    let durationMin = 0;
    if (visited.length > 0) {
      const firstIso = visited[0].arrived_at ?? visited[0].visited_at;
      const startMs = Date.parse(firstIso);
      const lastMs = plan.completed_at ? Date.parse(plan.completed_at) : Date.now();
      if (Number.isFinite(startMs) && Number.isFinite(lastMs) && lastMs > startMs) {
        durationMin = Math.round((lastMs - startMs) / 60_000);
      }
    }
    return {
      visitedCount: visited.length,
      durationMin,
      totalSpent,
    };
  }, [plan]);

  // ── Ceremony accent: dominant live state across visited stops.
  const ceremonyAccent: StateAccent = useMemo(() => {
    if (!plan?.stops || !liveByVenueId) return accentForState('unknown');
    const counts: Record<string, number> = {};
    for (const s of plan.stops as any[]) {
      const visited = (s.arrived_at || s.visited_at) && !s.skipped_at;
      if (!visited) continue;
      const live = liveByVenueId.get(s.venue_id);
      const key = (live?.state_label ?? 'unknown').toLowerCase();
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
    return accentForState(sorted[0]?.[0] ?? 'unknown');
  }, [plan, liveByVenueId]);

  // The hero choreographs via per-word spans below — no need to
  // imperatively flip a data-state on the heading anymore. Word
  // stagger (0/120/240/380/520ms) is driven entirely by CSS.

  // Rate now → mount the RateNightFlow over the ceremony. The
  // ceremony's auto-dismiss timer is paused while the flow is up.
  const handleRateNow = () => {
    if (isExiting || showRateFlow) return;
    void hapticMedium();
    setShowRateFlow(true);
  };

  // Rate later → flag the plan for the morning push cron + close.
  const handleRateLater = async () => {
    if (isExiting) return;
    void hapticLight();
    if (planId) {
      try {
        await supabase
          .from('night_plans')
          .update({ rating_status: 'pending_morning' })
          .eq('id', planId);
      } catch (err) {
        console.warn('[ceremony] rate-later flag failed:', err);
      }
    }
    setIsExiting(true);
    window.setTimeout(onComplete, 400);
  };

  // ── Auto-dismiss after 12s if the user does nothing.
  //    Paused while the rate flow is mounted — the flow's own
  //    onComplete drives dismissal in that case.
  useEffect(() => {
    if (!plan || showRateFlow) return;
    const t = window.setTimeout(() => { void handleRateLater(); }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
    // handleRateLater is stable enough — we want this timer to start
    // once per plan load, not reset on isExiting flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, showRateFlow]);

  if (!plan || !stats) return null;

  const stopCount = Math.max(1, plan.stops.length);
  const lineLength = (stopCount - 1) * 100;
  const viewBoxWidth = stopCount * 100;

  return (
    <div
      className={`end-night-ceremony${isExiting ? ' end-night-ceremony--exiting' : ''}`}
      style={{
        ['--ceremony-tint' as string]: ceremonyAccent.fluid,
        ['--ceremony-glow' as string]: ceremonyAccent.glow,
        ['--ceremony-label' as string]: ceremonyAccent.label,
      } as React.CSSProperties}
      role="dialog"
      aria-modal="true"
    >
      <h1 className="end-night-ceremony__hero">
        <span className="end-night-ceremony__hero-word" style={{ animationDelay: '0ms' }}>that</span>
        {' '}
        <span className="end-night-ceremony__hero-word" style={{ animationDelay: '120ms' }}>was</span>
        {' '}
        <span className="end-night-ceremony__hero-word" style={{ animationDelay: '240ms' }}>a</span>
        {' '}
        <span className="end-night-ceremony__hero-word" style={{ animationDelay: '380ms' }}>good</span>
        {' '}
        <span className="end-night-ceremony__hero-word" style={{ animationDelay: '520ms' }}>run</span>
      </h1>

      <div className="end-night-ceremony__plan-title">{plan.title}</div>

      <div className="end-night-ceremony__stats">
        <div className="end-night-ceremony__stat">
          <AnimatedCounter from={0} to={stats.visitedCount} duration={900} />
          <div className="end-night-stat__label">
            {stats.visitedCount === 1 ? 'stop visited' : 'stops visited'}
          </div>
        </div>
        <div className="end-night-ceremony__stat">
          <AnimatedCounter
            from={0}
            to={stats.durationMin}
            duration={1100}
            suffix="m"
          />
          <div className="end-night-stat__label">on the night</div>
        </div>
        <div className="end-night-ceremony__stat">
          <AnimatedCounter
            from={0}
            to={stats.totalSpent}
            duration={1300}
            prefix="$"
          />
          <div className="end-night-stat__label">estimated spent</div>
        </div>
      </div>

      <div className="end-night-ceremony__constellation">
        <svg
          viewBox={`0 0 ${viewBoxWidth} 40`}
          preserveAspectRatio="none"
          style={{ width: '100%', height: 40, display: 'block', overflow: 'visible' }}
          aria-hidden
        >
          <defs>
            <linearGradient id="constellation-grad-ceremony" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="#FF8200" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#FFB350" stopOpacity="0.6" />
            </linearGradient>
          </defs>
          {stopCount > 1 && (
            <line
              x1={50}
              y1={20}
              x2={lineLength + 50}
              y2={20}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1.5}
            />
          )}
          {stopCount > 1 && (
            <line
              x1={50}
              y1={20}
              x2={lineLength + 50}
              y2={20}
              stroke="url(#constellation-grad-ceremony)"
              strokeWidth={2}
              strokeLinecap="round"
              className="constellation-draw-line"
              style={{
                strokeDasharray: lineLength,
                ['--line-length' as string]: `${lineLength}`,
              } as React.CSSProperties}
            />
          )}
          {plan.stops.map((stop: any, idx: number) => {
            const cx = idx * 100 + 50;
            const skipped = !!stop.skipped_at && !(stop.arrived_at || stop.visited_at);
            const visited = !!(stop.arrived_at || stop.visited_at) && !skipped;
            const delay = `${2400 + idx * 180}ms`;
            return (
              <g key={`${stop.venue_id}-${idx}`}>
                {visited && (
                  <circle
                    cx={cx}
                    cy={20}
                    r={9}
                    fill="rgba(255,130,0,0.15)"
                    className="constellation-halo"
                    style={{ animationDelay: delay }}
                  />
                )}
                <circle
                  cx={cx}
                  cy={20}
                  r={skipped ? 4 : 5.5}
                  fill={skipped ? 'rgba(255,255,255,0.25)' : '#FF8200'}
                  className="constellation-dot"
                  style={{
                    animationDelay: delay,
                    transformOrigin: `${cx}px 20px`,
                  }}
                />
              </g>
            );
          })}
        </svg>
        <div
          className="constellation-names"
          style={{ ['--stop-count' as string]: String(stopCount) } as React.CSSProperties}
        >
          {plan.stops.map((stop: any, idx: number) => {
            const skipped = !!stop.skipped_at && !(stop.arrived_at || stop.visited_at);
            return (
              <div
                key={`${stop.venue_id}-${idx}-name`}
                className={`constellation-name${skipped ? ' constellation-name--skipped' : ''}`}
                style={{ animationDelay: `${2600 + idx * 180}ms` }}
              >
                {stop.venue_name}
              </div>
            );
          })}
        </div>
      </div>

      <div className="end-night-ceremony__ctas">
        <button
          type="button"
          className="action-here end-night-ceremony__rate"
          onClick={handleRateNow}
        >
          <span className="action-here__fluid" aria-hidden />
          <span className="action-here__label">rate this night</span>
        </button>
        <button
          type="button"
          className="end-night-ceremony__later"
          onClick={() => { void handleRateLater(); }}
        >
          rate it later
        </button>
      </div>

      {/* Rate Night flow — mounts ABOVE the ceremony (z-index 320
       *  vs 300). The ceremony stays in the DOM behind it; once the
       *  flow completes we run the same dismiss sequence. */}
      {showRateFlow && (
        <RateNightFlow
          planId={planId}
          onComplete={() => {
            setShowRateFlow(false);
            setIsExiting(true);
            window.setTimeout(onComplete, 300);
          }}
          onSkip={() => {
            // User bailed out — flag plan for the morning push so
            // they get nudged tomorrow, then close the ceremony.
            setShowRateFlow(false);
            void handleRateLater();
          }}
        />
      )}
    </div>
  );
}
