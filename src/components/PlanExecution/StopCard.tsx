import { memo, useEffect, useRef, useState } from 'react';
import type { PlanStop } from '../Venny/PlanCard';
import { hapticLight, hapticMedium } from '../../lib/haptics';
import { formatWalkDistance } from '../../lib/directions';

/**
 * StopCard — one row in the Plan Execution Page's vertical stack.
 *
 * Visual identity per state lives in src/index.css under the
 * .stop-card / .stop-card--<state> selectors. This file owns
 * behavior only — taps, hold-to-skip progress, distance labels.
 *
 *   upcoming  — collapsed, dimmed
 *   current   — full hero treatment with live meta + actions
 *   arrived   — green check, short memory line
 *   skipped   — ghost row with strikethrough
 *   completed — gold-accent final stop (post-EndNight)
 */

export type StopCardState = 'upcoming' | 'current' | 'arrived' | 'skipped' | 'completed';

export interface LiveStopState {
  state_label: string | null;
  estimate: number | null;
  capacity_pct: number | null;
}

interface StopCardProps {
  stop: PlanStop;
  index: number;
  totalStops: number;
  state: StopCardState;
  live?: LiveStopState | null;
  distanceMeters: number | null;
  isPulsing: boolean;
  onMarkHere: () => void;
  onSkip: () => void;
  onGetDirections: () => void;
  onLeaveEarly?: () => void;
  onUndoSkip?: () => void;
  descriptionExcerpt?: string | null;
  /** Read-only summary mode hides all action surfaces. */
  viewOnly?: boolean;
  /** When true, run a brief green celebratory glow on the arrived
   *  state. Driven by PlanSheet on the moment a stop transitions to
   *  ARRIVED — clears ~1200ms later. */
  justArrived?: boolean;
}

const HOLD_TO_SKIP_MS = 700;

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function stayedLabel(arrivedIso: string | null | undefined, leftIso: string | null | undefined): string {
  if (!arrivedIso) return '';
  const startMs = Date.parse(arrivedIso);
  const endMs = leftIso ? Date.parse(leftIso) : Date.now();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return '';
  const mins = Math.round((endMs - startMs) / 60_000);
  return `stayed ${mins} min`;
}

function StopCardInner(props: StopCardProps) {
  const {
    stop, index, state, live, distanceMeters, isPulsing,
    descriptionExcerpt, viewOnly, justArrived,
  } = props;

  // Hold-to-skip state — UI feedback timer + actual fire callback.
  const [holding, setHolding] = useState(false);
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function startSkipHold() {
    if (state !== 'current' || viewOnly) return;
    void hapticLight();
    setHolding(true);
    skipTimerRef.current = setTimeout(() => {
      void hapticMedium();
      setHolding(false);
      props.onSkip();
    }, HOLD_TO_SKIP_MS);
  }
  function endSkipHold() {
    if (skipTimerRef.current) {
      clearTimeout(skipTimerRef.current);
      skipTimerRef.current = null;
    }
    setHolding(false);
  }
  useEffect(() => () => { if (skipTimerRef.current) clearTimeout(skipTimerRef.current); }, []);

  const numberLabel = String(index + 1);

  // ─── UPCOMING ────────────────────────────────────────────────
  if (state === 'upcoming') {
    return (
      <div className="stop-card stop-card--upcoming">
        <div className="stop-card__rail">
          <div className="stop-number stop-number--upcoming">{numberLabel}</div>
        </div>
        <div className="stop-card__content">
          <div className="stop-card__row">
            <div className="stop-card__name">{stop.venue_name}</div>
            <div className="stop-card__time">{stop.arrival_time ? `~${stop.arrival_time}` : ''}</div>
          </div>
          <div className="stop-card__state-label">upcoming</div>
        </div>
      </div>
    );
  }

  // ─── ARRIVED ─────────────────────────────────────────────────
  if (state === 'arrived') {
    const arrivedTime = formatTime(stop.arrived_at ?? stop.visited_at ?? null);
    const stayed = stayedLabel(stop.arrived_at ?? stop.visited_at ?? null, stop.left_at);
    return (
      <div
        className="stop-card stop-card--arrived"
        data-just-arrived={justArrived ? 'true' : undefined}
        onClick={() => props.onLeaveEarly?.()}
        role={viewOnly ? undefined : 'button'}
        tabIndex={viewOnly ? -1 : 0}
      >
        <div className="stop-card__rail">
          <div className="stop-number stop-number--arrived" aria-label="arrived">✓</div>
        </div>
        <div className="stop-card__content">
          <div className="stop-card__name">{stop.venue_name}</div>
          <div className="stop-card__memory">
            {arrivedTime ? `arrived ${arrivedTime}` : 'arrived'}
            {stayed ? ` · ${stayed}` : ''}
            {typeof stop.estimated_cost === 'number' ? ` · $${stop.estimated_cost}` : ''}
          </div>
        </div>
      </div>
    );
  }

  // ─── SKIPPED ─────────────────────────────────────────────────
  if (state === 'skipped') {
    return (
      <div
        className="stop-card stop-card--skipped"
        onClick={() => props.onUndoSkip?.()}
        role={viewOnly ? undefined : 'button'}
        tabIndex={viewOnly ? -1 : 0}
      >
        <div className="stop-card__rail">
          <div className="stop-number stop-number--skipped">{numberLabel}</div>
        </div>
        <div className="stop-card__content">
          <div className="stop-card__row">
            <div className="stop-card__name">{stop.venue_name}</div>
            <div className="stop-card__state-label">skipped</div>
          </div>
        </div>
      </div>
    );
  }

  // ─── COMPLETED ──────────────────────────────────────────────
  if (state === 'completed') {
    const arrivedTime = formatTime(stop.arrived_at ?? stop.visited_at ?? null);
    const completedTime = formatTime(stop.completed_at);
    return (
      <div className="stop-card stop-card--completed">
        <div className="stop-card__rail">
          <div className="stop-number stop-number--completed" aria-label="completed">✓</div>
        </div>
        <div className="stop-card__content">
          <div className="stop-card__name" style={{ color: '#FFFFFF', fontSize: 15, fontWeight: 700 }}>
            {stop.venue_name}
          </div>
          <div className="stop-card__memory">
            completed the run
            {completedTime ? ` · ${completedTime}` : arrivedTime ? ` · ${arrivedTime}` : ''}
          </div>
        </div>
      </div>
    );
  }

  // ─── CURRENT — the hero ──────────────────────────────────────
  const stateLabel = live?.state_label ?? 'live';
  const distanceLabel = (() => {
    if (distanceMeters == null) return null;
    if (distanceMeters < 60) return "you're here";
    return `you're ${formatWalkDistance(distanceMeters)} away`;
  })();
  const isProximate = distanceMeters != null && distanceMeters < 100;

  return (
    <div
      className="stop-card stop-card--current"
      data-pulsing={isPulsing ? 'true' : 'false'}
      data-stop-index={index}
    >
      <div className="stop-card__ambient-glow" aria-hidden />
      <div className="stop-card__rail">
        <div className="stop-number stop-number--current">
          <span className="stop-number__digit">{numberLabel}</span>
          <span className="stop-number__ring" aria-hidden />
        </div>
      </div>
      <div className="stop-card__content">
        <div className="stop-card__header">
          <h2 className="stop-card__name stop-card__name--current weight-choreograph" data-state="settled">
            {stop.venue_name}
          </h2>
          <div className="stop-card__state-pill">
            <span className="stop-card__state-dot" aria-hidden />
            {stateLabel}
          </div>
        </div>

        {descriptionExcerpt && (
          <div className="stop-card__description">
            <p>{descriptionExcerpt}</p>
          </div>
        )}

        <div className="stop-card__meta">
          <span>
            {live?.estimate != null ? `${live.estimate} inside` : 'no read yet'}
          </span>
          {distanceLabel && <span className="stop-card__divider">·</span>}
          {distanceLabel && <span>{distanceLabel}</span>}
        </div>

        {!viewOnly && (
          <>
            <button
              type="button"
              className="action-here"
              data-proximate={isProximate ? 'true' : 'false'}
              onClick={() => { void hapticMedium(); props.onMarkHere(); }}
            >
              <span className="action-here__fluid" aria-hidden />
              <span className="action-here__label">i'm here</span>
            </button>

            <div className="action-secondary-row">
              <button
                type="button"
                className="action-skip"
                data-holding={holding ? 'true' : 'false'}
                onPointerDown={startSkipHold}
                onPointerUp={endSkipHold}
                onPointerLeave={endSkipHold}
                onPointerCancel={endSkipHold}
              >
                <span className="action-skip__progress" aria-hidden />
                <span className="action-skip__label">
                  {holding ? 'hold to skip…' : 'skip'}
                </span>
              </button>
              <button
                type="button"
                className="action-directions"
                onClick={() => { void hapticLight(); props.onGetDirections(); }}
              >
                <span>directions</span>
                <span aria-hidden style={{ fontSize: 11, lineHeight: 1 }}>↗</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export const StopCard = memo(StopCardInner);
