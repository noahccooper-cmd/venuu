import { memo, useEffect, useRef } from 'react';
import { hapticMedium } from '../../lib/haptics';
import { accentForState, timing } from '../../lib/planExecutionTokens';
import type { StateAccent } from '../../lib/planExecutionTokens';

/**
 * ArrivalCelebration — the moment a stop transitions to ARRIVED.
 *
 * NO confetti. Three liquid waves expand from the venue position
 * outward (in the venue's state colour), the venue name fades in
 * with typography choreography (weight 300 → 880 over 720ms), and
 * a small badge lands below before everything fades out.
 *
 * Total runtime: 2.2s (timing.beatCeremonial).
 */

interface ArrivalCelebrationProps {
  venueName: string;
  /** 1-indexed position within the plan (display only). */
  stopNumber: number;
  /** Live state of the venue at the arrival moment, used to colour
   *  the liquid waves. Falls back to the brand orange when null. */
  stateLabel?: string | null;
  /** Pre-resolved accent — pass when the parent already has one;
   *  otherwise we compute from stateLabel. */
  accent?: StateAccent;
  onComplete: () => void;
}

function ArrivalCelebrationInner({
  venueName,
  stopNumber,
  stateLabel,
  accent: accentOverride,
  onComplete,
}: ArrivalCelebrationProps) {
  const accent = accentOverride ?? accentForState(stateLabel);
  const mountedRef = useRef(true);
  // Headline weight choreography — start at "settling" so the
  // animation transitions to "settled" on next paint.
  const headlineRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    void hapticMedium();

    // Step the weight via the choreograph utility: settling → settled
    // happens after the entry fade completes (~560ms).
    const t1 = window.setTimeout(() => {
      const el = headlineRef.current;
      if (el) el.dataset.state = 'settled';
    }, 560);

    const t2 = window.setTimeout(() => {
      if (mountedRef.current) onComplete();
    }, timing.beatCeremonial);

    return () => {
      mountedRef.current = false;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [onComplete]);

  return (
    <div
      className="liquid-arrival"
      style={{
        ['--liquid-color' as string]: accent.fluid,
        ['--liquid-glow' as string]: accent.glow,
        ['--liquid-primary' as string]: accent.primary,
      } as React.CSSProperties}
      aria-hidden
    >
      <div className="liquid-arrival__backdrop" />
      <div className="liquid-arrival__wave liquid-arrival__wave--1" />
      <div className="liquid-arrival__wave liquid-arrival__wave--2" />
      <div className="liquid-arrival__wave liquid-arrival__wave--3" />

      <div className="liquid-arrival__content">
        <div className="liquid-arrival__label">you made it to</div>
        <h1
          ref={headlineRef}
          className="liquid-arrival__name weight-choreograph"
          data-state="settling"
        >
          {venueName}
        </h1>
        <div className="liquid-arrival__badge">+ stop {stopNumber} visited</div>
      </div>
    </div>
  );
}

export const ArrivalCelebration = memo(ArrivalCelebrationInner);
