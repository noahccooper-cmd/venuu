import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { HeadcountEstimate } from '../../hooks/useVenuesInBounds';
import { getCoverLabel } from '../../lib/utils';
import { FEATURE_FLAGS } from '../../lib/featureFlags';
import { CapacityRing } from './CapacityRing';
import { vibeToHsl, vibeToGlow, type VibeHueId } from '../../lib/hueMath';
import { useCurrentTimeBand } from '../../hooks/useCurrentTimeBand';

/**
 * LiveVenueBubble — luxury nightlife visual language.
 *
 * Architecture
 *   The breath, surging ring, and trend animations all live in pure
 *   CSS keyframes on a CHILD div. The outer <motion.button> handles
 *   only react-driven motion (mount fade, isSelected lift, whileTap).
 *   Framer Motion sets `transform` inline on the outer; the CSS-driven
 *   `transform: scale(...)` keyframe runs on a separate child element
 *   so the two never compete. As a result the breath continues
 *   uninterrupted through every realtime estimate update — no flicker.
 *
 *   Words first, numbers as support. The pill auto-sizes to its
 *   content with a min-width of 88px and a max of 200px so the longest
 *   possible label ("Surging · 199") never truncates.
 */

type StateLabel = 'Quiet' | 'Lively' | 'Busy' | 'Packed' | 'Surging' | 'Unknown';

interface LiveVenueBubbleProps {
  venueId?: string;
  venueName?: string;
  estimate: HeadcountEstimate | null | undefined;
  /** Raw `cover_charge` string from the venue row (e.g. "FREE", "$5"). */
  coverCharge?: string | null;
  isSelected?: boolean;
  onTap?: () => void;
  /** During the intro's bubble-bloom phase, ms to delay this bubble's
   *  bloom-in animation (staggered from screen center outward). */
  introBloomDelay?: number;
  /** When true, Venny has called highlight_on_map for this venue —
   *  the bubble gets an orange focus ring + scale-up + boosted z so
   *  it pops above the (faded) non-highlighted peers. */
  highlighted?: boolean;
  /** Current Mapbox zoom level — market mode renders different sizes
   *  per altitude bucket. Ignored by the legacy path. Three buckets:
   *  <13 wide (dot only), 13-15 mid, >=15 tight (hero). */
  mapZoom?: number;
  /** Market View Mode active — applies BOLD per-state transforms,
   *  staggered entry, and the Surging double-ring broadcast. Off
   *  by default; bubbles render in their normal market styling. */
  marketView?: boolean;
  /** When true (and `marketView` is also true), this bubble is the
   *  currently-spotlighted venue from the MarketPanel. Overrides
   *  scale, max-glow, and adds a pulse. */
  isSpotlight?: boolean;
  /** 0–1 normalized magnitude of |delta_pct|. Biggest mover ≈ 1
   *  (lights first), zero-delta ≈ 0 (lights last). Drives a stagger
   *  delay on the BOLD entry animation. */
  movementMagnitude?: number;
  /** Phase 5.1 — smart-density name label gate. When true (top-5
   *  mover, near-user, spotlit, or zoom ≥ 16), the bubble renders
   *  the full venue name just below it. */
  showName?: boolean;
  /** Phase 6 (Vibe) — founder-authored hue per time band. Drives the
   *  bubble's HUE channel via hueMath. Saturation = state, lightness
   *  = capacity. Optional/null → bubble falls back to neutral grey. */
  vibeHueBaseline?: {
    wk_early?: number;
    wk_peak?: number;
    wknd_early?: number;
    wknd_peak?: number;
  } | null;
}

interface StateVisuals {
  background: string;
  textColor: string;
  edge: string;       // hex used for border tint, inset glow, outer glow
}

function visualsFor(state: StateLabel): StateVisuals {
  switch (state) {
    case 'Quiet':
      // Muted royal purple — the field's amethyst transition tier.
      return { background: '#3D2A5E', textColor: '#C9B4E0', edge: '#5E4480' };
    case 'Lively':
      return { background: 'linear-gradient(135deg, #8B6520, #B8862F)', textColor: '#FFF8E7', edge: '#8B6520' };
    case 'Busy':
      return { background: 'linear-gradient(135deg, #6B2818, #8B3A20)', textColor: '#FFE8DC', edge: '#6B2818' };
    case 'Packed':
      return { background: 'linear-gradient(135deg, #4A0F1A, #6B1525)', textColor: '#F5D5DC', edge: '#4A0F1A' };
    case 'Surging':
      // The only neon. Persistent green halo defined in keyframes.
      return { background: '#0A0A0A', textColor: '#00FFA3', edge: '#00FFA3' };
    case 'Unknown':
    default:
      return { background: 'rgba(30, 30, 30, 0.5)', textColor: '#8A8A95', edge: '#3A3A40' };
  }
}

function normalizeState(label: string | undefined): StateLabel {
  if (!label) return 'Unknown';
  const s = label as StateLabel;
  if (s === 'Quiet' || s === 'Lively' || s === 'Busy' || s === 'Packed' || s === 'Surging' || s === 'Unknown') {
    return s;
  }
  return 'Unknown';
}

/* ── Signature display helpers ────────────────────────────────────
   Three-line bubble stack: state · count · capacity. Each line is
   styled by the confidence tier of the estimate so the bubble's
   typographic tone shifts between trust-it (sharp) and vibe-check
   (tentative). */

type ConfTier = 'sharp' | 'soft' | 'tentative' | 'none';

function getConfTier(confidence: number): ConfTier {
  if (confidence >= 60) return 'sharp';
  if (confidence >= 30) return 'soft';
  if (confidence >= 20) return 'tentative';
  return 'none';
}

function getCountText(estimate: number | null, tier: ConfTier): string | null {
  if (estimate == null || estimate < 0) return null;
  // Sharp + soft both use the regular dot — soft's uncertainty comes
  // from italic + reduced opacity, not punctuation. Tilde is reserved
  // for tentative so it reads exclusively as "lower confidence".
  if (tier === 'sharp')     return `· ${estimate}`;
  if (tier === 'soft')      return `· ${estimate}`;
  if (tier === 'tentative') return `~ ${estimate}`;
  return null;
}

/**
 * Phase 1 (Recon→Restore) — single-arg capacity narrator.
 * Pure capacity-percentage ladder. The phrase vocabulary is the
 * Legacy capsule's locked language — "barely there", "filling fast",
 * "almost full", "at capacity", "over capacity 🔥" — extended with
 * "dead inside" at the floor and a numeric mid-band so values that
 * fall in the 30-60% range get a concrete number rather than a vibe.
 */
function getCapacityText(capacityPct: number | null | undefined): string | null {
  if (capacityPct == null) return null;
  if (capacityPct >= 1.10) return 'over capacity 🔥';
  if (capacityPct >= 1.00) return 'at capacity';
  if (capacityPct >= 0.85) return 'almost full';
  if (capacityPct >= 0.70) return 'filling fast';
  if (capacityPct >= 0.20) return `${Math.round(capacityPct * 100)}% full`;
  if (capacityPct >= 0.15) return 'barely there';
  if (capacityPct >= 0.01) return 'dead inside';
  return null;
}

interface BaselineSourceShape { baseline_source?: unknown }

function getCountPrefix(sourceBreakdown: Record<string, unknown> | null | undefined): string {
  const src = (sourceBreakdown as BaselineSourceShape | null | undefined)?.baseline_source;
  return src === 'bouncer_override' ? '✓ ' : '';
}

/**
 * Algorithm-run gate. The fusion engine writes a `baseline_source`
 * value into source_breakdown that tells us which signal track the
 * estimate came from:
 *
 *   besttime_live      — live busyness from BestTime, last 90 min
 *   besttime_forecast  — current-hour BestTime forecast curve
 *   bouncer_override   — manual headcount click in the last 60 min
 *   category_default   — fallback heuristic (no real signal)
 *   no_data            — sentinel for "we have absolutely nothing"
 *
 * The first three are the algorithm actually doing work; the last two
 * are guesses. We render bubbles only for the first three so the map
 * doesn't lie about venues we have no data for.
 */
const ALGORITHM_SOURCES = new Set([
  'besttime_live',
  'besttime_forecast',
  'bouncer_override',
]);

function hasAlgorithmData(estimate: HeadcountEstimate | null | undefined): boolean {
  if (!estimate) return false;
  const src = estimate.source_breakdown?.baseline_source;
  return typeof src === 'string' && ALGORITHM_SOURCES.has(src);
}

/**
 * Smoothly animates the count number from prev → next over ~600ms with a
 * gentle overshoot (cubic-bezier(0.34, 1.56, 0.64, 1) approximation).
 * Skips the first-mount tick so the bubble doesn't count up from 0 on
 * appearance — only realtime updates animate.
 */
function useAnimatedNumber(target: number): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === display) return;
    const from = fromRef.current;
    const to = target;
    const start = performance.now();
    const dur = 600;
    const ease = (t: number) => {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    };
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const v = from + (to - from) * ease(t);
      setDisplay(Math.round(v));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return display;
}

/** Class name driven by trend; `lvb-rising` is one-shot, `lvb-falling` is persistent. */
function useTrendClass(trend: string | null | undefined): string {
  const prevTrendRef = useRef<string | null | undefined>(trend);
  const [risingActive, setRisingActive] = useState(false);

  useEffect(() => {
    const prev = prevTrendRef.current;
    prevTrendRef.current = trend;
    if (trend === 'rising' && prev !== 'rising') {
      setRisingActive(true);
      const t = setTimeout(() => setRisingActive(false), 8000); // 2 × 4s cycles
      return () => clearTimeout(t);
    }
  }, [trend]);

  if (risingActive) return 'lvb-rising';
  if (trend === 'falling') return 'lvb-falling';
  return '';
}

function LegacyLiveVenueBubbleInner({ venueId, estimate, coverCharge, isSelected, onTap, introBloomDelay, highlighted }: LiveVenueBubbleProps) {
  const useBloom = (introBloomDelay ?? 0) >= 0 && introBloomDelay !== undefined && introBloomDelay > -1;
  // Only opt into the bloom class when a delay was explicitly provided
  // AND non-negative. Once the parent stops passing the prop the class
  // disappears on the next render and subsequent prop changes don't
  // re-trigger the keyframe (forwards-fill keeps the final state).
  const bloomEnabled = useBloom && typeof introBloomDelay === 'number';
  const bloomStyle = bloomEnabled ? { animationDelay: `${Math.max(0, introBloomDelay!)}ms` } : undefined;
  // Cover badge in the top-right corner — green pill when free,
  // gold-on-charcoal when paid. Suppressed entirely when the venue
  // has no cover_charge value set.
  const coverLabel = coverCharge ? getCoverLabel(coverCharge) : null;
  const showCoverBadge = !!coverLabel;
  const coverIsFree = coverLabel === 'FREE';
  // ─── Defer the gray pin so a 50–250ms-late realtime estimate avoids the flash ───
  const [pinUnlocked, setPinUnlocked] = useState(false);
  useEffect(() => {
    if (estimate) {
      setPinUnlocked(false);
      return;
    }
    const t = setTimeout(() => setPinUnlocked(true), 250);
    return () => clearTimeout(t);
  }, [!!estimate]);

  // ─── Surge celebration — fired by LiveEventsFeed when a surge_first
  //     or surge_rapid_rise event lands for THIS venue. Plays a one-off
  //     scale burst + 4 particle plumes + glow flash, then resets.
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    if (!venueId) return;
    function onCelebrate(e: Event) {
      const detail = (e as CustomEvent).detail as { venueId?: string } | undefined;
      if (!detail?.venueId || detail.venueId !== venueId) return;
      setCelebrating(true);
      window.setTimeout(() => setCelebrating(false), 1500);
    }
    window.addEventListener('venuu-surge-celebration', onCelebrate as EventListener);
    return () => window.removeEventListener('venuu-surge-celebration', onCelebrate as EventListener);
  }, [venueId]);

  const stateLabel = normalizeState(estimate?.state_label);
  const confidence = estimate?.confidence_pct ?? 0;
  const trend = estimate?.trend ?? null;
  const capacityPct = estimate?.capacity_pct ?? null;
  const trendClass = useTrendClass(trend);
  const animatedCount = useAnimatedNumber(estimate?.estimate ?? 0);

  // Tap-emphasize: 800ms window during which count + capacity glow
  // up to full opacity for a satisfying micro-reward. Independent of
  // the parent click handler — the marker el's listener still fires.
  // MUST live above the early-return gates below so React sees the
  // same hook order on every render (Rules of Hooks).
  const [tapped, setTapped] = useState(false);
  useEffect(() => {
    if (!tapped) return;
    const t = window.setTimeout(() => setTapped(false), 800);
    return () => window.clearTimeout(t);
  }, [tapped]);

  // ─── Algorithm-run gate — bubbles HIT HARD but only for venues
  //     the fusion engine actually has signal on. Cold venues
  //     (category_default / no_data / no row yet) render nothing;
  //     the heat field carries their presence on the map.
  if (!hasAlgorithmData(estimate)) {
    if (!pinUnlocked && !estimate) {
      // 250ms grace in case the realtime estimate is just slow.
      return <span aria-hidden style={{ display: 'none' }} />;
    }
    return null;
  }

  // Confidence floor still applies inside the algorithm-run set —
  // when the engine itself isn't sure (Unknown / very low conf),
  // we suppress the bubble rather than asserting state we don't
  // believe in.
  if (stateLabel === 'Unknown' || confidence < 20) return null;

  const v = visualsFor(stateLabel);

  // Signature-display content
  const tier = getConfTier(confidence);
  const countText = getCountText(animatedCount, tier);
  const capacityText = getCapacityText(capacityPct);
  const countPrefix = getCountPrefix(estimate?.source_breakdown);
  const isBouncerVerified = countPrefix.length > 0;
  const isSurging = stateLabel === 'Surging';
  const isOverCap = capacityPct !== null && capacityPct >= 1.0;

  // ─── Confidence → light, not lines ───
  // High: no border, inset glow tinted to bubble. Medium: 1px @ 30%
  // edge tint. Low: no border, soft outer halo at 20%.
  let borderCss: string = 'none';
  let baseShadow: string;

  if (stateLabel === 'Surging') {
    // Surging always wears its persistent neon halo, regardless of confidence.
    baseShadow = '0 0 20px #00FFA3aa, 0 0 40px #00FFA355';
  } else if (confidence >= 50) {
    baseShadow = `inset 0 0 12px ${v.edge}55, 0 2px 10px rgba(0,0,0,0.35)`;
  } else if (confidence >= 20) {
    borderCss = `1px solid ${v.edge}4D`; // 4D ≈ 30% alpha
    baseShadow = '0 2px 8px rgba(0,0,0,0.3)';
  } else {
    baseShadow = `0 0 8px ${v.edge}33, 0 2px 8px rgba(0,0,0,0.3)`;
  }

  const stateClass =
    stateLabel === 'Surging' ? 'lvb-bubble lvb-surging' : 'lvb-bubble';

  // Bloom wrapper — present only during the cinematic intro's
  // bubble-bloom phase. Its transform doesn't compete with framer's
  // inline transforms on the inner motion.button because framer
  // operates one DOM level deeper.
  const Outer: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    bloomEnabled
      ? <div className="lvb-intro-bloom" style={bloomStyle}>{children}</div>
      : <>{children}</>;

  return (
    <Outer>
    <motion.button
      type="button"
      onClick={onTap}
      className={highlighted ? 'lvb-highlighted' : undefined}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={
        celebrating
          ? { opacity: 1, scale: [1, 1.15, 1] }
          : { opacity: 1, scale: isSelected ? 1.08 : 1 }
      }
      transition={
        celebrating
          ? { duration: 0.6, times: [0, 0.45, 1], ease: [0.34, 1.56, 0.64, 1] }
          : isSelected
            ? { type: 'spring', stiffness: 300, damping: 18 }
            : { duration: 0.22, ease: 'easeOut' }
      }
      whileTap={{ scale: 0.95 }}
      style={{
        // Outer is a transparent wrapper for framer transforms only.
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        display: 'inline-block',
        lineHeight: 0,
        position: 'relative',
      }}
    >
      {/* Celebration plume — 4 particles ascending, glow flash behind. */}
      {celebrating && (
        <>
          <span
            aria-hidden
            className="lvb-celebrate-glow"
            style={{
              position: 'absolute',
              inset: -10,
              borderRadius: 32,
              background: `radial-gradient(circle, ${v.edge}55 0%, transparent 70%)`,
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
          {[0, 1, 2, 3].map(i => (
            <span
              key={i}
              aria-hidden
              className="lvb-celebrate-particle"
              style={{
                position: 'absolute',
                top: '40%',
                left: `${30 + i * 14}%`,
                width: 5,
                height: 5,
                borderRadius: 5,
                background: v.edge,
                pointerEvents: 'none',
                zIndex: 2,
                animationDelay: `${i * 50}ms`,
                boxShadow: `0 0 6px ${v.edge}`,
              }}
            />
          ))}
        </>
      )}
      <div
        className={`${stateClass} ${trendClass}`}
        onClick={() => setTapped(true)}
        style={{
          // Visual shell — CSS keyframes own this element's transform.
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 88,
          maxWidth: 200,
          minHeight: 58,
          padding: '9px 16px',
          borderRadius: 24,
          background: v.background,
          color: v.textColor,
          border: borderCss,
          boxShadow: baseShadow,
          fontFamily: 'Satoshi, sans-serif',
          lineHeight: 1.0,
          whiteSpace: 'nowrap',
          wordBreak: 'keep-all',
          textAlign: 'center',
          willChange: 'transform, filter, opacity',
        }}
      >
        {showCoverBadge && (
          <span
            className={`lvb-cover-badge${coverIsFree ? '' : ' has-cover'}`}
            aria-label={coverIsFree ? 'Free entry' : `Cover ${coverLabel}`}
          >
            {coverLabel}
          </span>
        )}
        <AnimatePresence mode="wait">
          <motion.div
            key={stateLabel}
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 2 }}
            transition={{ duration: 0.18 }}
            className={`lvb-content${isSurging ? ' lvb-surging-stack' : ''}`}
          >
            <div className="lvb-state">{stateLabel}</div>

            {countText && (
              <div
                className={
                  `lvb-count lvb-count-${tier}` +
                  (isBouncerVerified ? ' lvb-verified' : '') +
                  (trend === 'rising'  ? ' lvb-count-rising'  : '') +
                  (trend === 'falling' ? ' lvb-count-falling' : '') +
                  (tapped ? ' lvb-tapped' : '')
                }
              >
                {countPrefix}{countText}
              </div>
            )}

            {capacityText && (
              <div
                className={
                  `lvb-capacity lvb-capacity-${tier}` +
                  (isOverCap ? ' lvb-overcap' : '') +
                  (tapped ? ' lvb-tapped' : '')
                }
              >
                {capacityText}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Inline keyframes — see header docstring for why these aren't shared with index.css. */}
      <style>{LVB_KEYFRAMES}</style>
    </motion.button>
    </Outer>
  );
}

const LVB_KEYFRAMES = `
@keyframes lvb-luxury-breath {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.015); }
}
@keyframes lvb-aurora-shimmer {
  0%   { box-shadow: 0 0 22px rgba(0, 255, 163, 0.65),
                     0 0 42px rgba(0, 255, 163, 0.35); }
  25%  { box-shadow: 0 0 26px rgba(0, 200, 220, 0.78),
                     0 0 50px rgba(0, 200, 220, 0.42); }
  50%  { box-shadow: 0 0 28px rgba(80, 255, 110, 0.80),
                     0 0 55px rgba(80, 255, 110, 0.45); }
  75%  { box-shadow: 0 0 26px rgba(0, 230, 255, 0.74),
                     0 0 50px rgba(0, 230, 255, 0.42); }
  100% { box-shadow: 0 0 22px rgba(0, 255, 163, 0.65),
                     0 0 42px rgba(0, 255, 163, 0.35); }
}
@keyframes lvb-rising-glow {
  0%, 100% { filter: brightness(1.0); }
  50%      { filter: brightness(1.15); }
}
@keyframes lvb-falling-dim {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.96; }
}

.lvb-bubble {
  animation: lvb-luxury-breath 3.5s ease-in-out infinite;
}
.lvb-surging {
  animation: lvb-luxury-breath 3.5s ease-in-out infinite,
             lvb-aurora-shimmer 5s ease-in-out infinite;
}
.lvb-rising {
  /* one-shot — controlling component removes the class after 8s */
  animation: lvb-luxury-breath 3.5s ease-in-out infinite,
             lvb-rising-glow 4s ease-in-out infinite;
}
.lvb-surging.lvb-rising {
  animation: lvb-luxury-breath 3.5s ease-in-out infinite,
             lvb-aurora-shimmer 5s ease-in-out infinite,
             lvb-rising-glow 4s ease-in-out infinite;
}
.lvb-falling {
  animation: lvb-luxury-breath 3.5s ease-in-out infinite,
             lvb-falling-dim 6s ease-in-out infinite;
}
.lvb-surging.lvb-falling {
  animation: lvb-luxury-breath 3.5s ease-in-out infinite,
             lvb-aurora-shimmer 5s ease-in-out infinite,
             lvb-falling-dim 6s ease-in-out infinite;
}

@keyframes lvb-celebrate-particle-rise {
  0%   { transform: translate(0, 0)    scale(1);   opacity: 1;   }
  60%  { transform: translate(0, -28px) scale(1.1); opacity: 0.9; }
  100% { transform: translate(0, -42px) scale(0.6); opacity: 0;   }
}
.lvb-celebrate-particle {
  animation: lvb-celebrate-particle-rise 800ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  will-change: transform, opacity;
}
@keyframes lvb-celebrate-glow-flash {
  0%   { opacity: 0;    transform: scale(0.85); }
  35%  { opacity: 0.95; transform: scale(1.1);  }
  100% { opacity: 0;    transform: scale(1.3);  }
}
.lvb-celebrate-glow {
  animation: lvb-celebrate-glow-flash 1500ms ease-out forwards;
  will-change: transform, opacity;
}

/* Cinematic intro bloom — applied during the bubble-bloom phase
   (Prompt 16B). Wrapper div, doesn't compete with framer's transforms
   on the inner motion.button. */
@keyframes lvb-bloom-in {
  0%   { opacity: 0; transform: scale(0.6); }
  100% { opacity: 1; transform: scale(1);   }
}
.lvb-intro-bloom {
  display: inline-block;
  opacity: 0;
  transform: scale(0.6);
  animation-name: lvb-bloom-in;
  animation-duration: 350ms;
  animation-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
  animation-fill-mode: forwards;
  will-change: transform, opacity;
}

/* ──────────────────────────────────────────────────────────────
   Signature display — three-line stack (state · count · capacity)
   ────────────────────────────────────────────────────────────── */
.lvb-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.0;
  gap: 1px;
}

.lvb-state {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.2px;
  line-height: 1.0;
}

.lvb-count {
  font-size: 13px;
  margin-top: 2px;
  letter-spacing: 0.3px;
  line-height: 1.0;
  transition: opacity 240ms ease-out;
}
.lvb-count-sharp     { font-weight: 700; opacity: 1.0; }
.lvb-count-soft      { font-weight: 500; opacity: 0.78; font-style: italic; }
.lvb-count-tentative { font-weight: 500; opacity: 0.62; font-style: italic; }

.lvb-verified {
  /* Subtle micro-signal alongside the leading ✓ — wider tracking
     so habitual users notice the verified visual texture. */
  letter-spacing: 0.4px;
}

.lvb-capacity {
  font-size: 12px;
  margin-top: 2px;
  letter-spacing: 0.3px;
  line-height: 1.0;
  text-transform: lowercase;
  font-weight: 500;
  transition: opacity 240ms ease-out;
}
.lvb-capacity-sharp     { opacity: 0.95; font-weight: 600; }
.lvb-capacity-soft      { opacity: 0.82; font-weight: 500; font-style: italic; }
.lvb-capacity-tentative { opacity: 0.68; font-style: italic; }

.lvb-overcap {
  font-weight: 600 !important;
  opacity: 1.0 !important;
}

.lvb-tapped {
  opacity: 1.0 !important;
}

/* Surging stack — aurora glow carries through every line */
.lvb-surging-stack .lvb-state    { text-shadow: 0 0 5px rgba(0, 255, 163, 0.45); }
.lvb-surging-stack .lvb-count    { text-shadow: 0 0 5px rgba(0, 255, 163, 0.40); }
.lvb-surging-stack .lvb-capacity { text-shadow: 0 0 4px rgba(0, 255, 163, 0.35); }

/* Cover badge — corner pill, green for FREE, gold-on-charcoal when paid */
.lvb-cover-badge {
  position: absolute;
  top: -8px;
  right: -10px;
  background: rgba(0, 200, 100, 0.92);
  color: white;
  font-size: 9.5px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 8px;
  letter-spacing: 0.4px;
  pointer-events: none;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  white-space: nowrap;
  z-index: 4;
}
.lvb-cover-badge.has-cover {
  background: rgba(40, 40, 50, 0.92);
  color: rgba(255, 220, 100, 0.95);
}

/* Trend micro-cues on the count line — fire twice then settle */
@keyframes lvb-count-uptick {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-1px); }
}
.lvb-count-rising {
  animation: lvb-count-uptick 2.4s ease-in-out 2;
}
@keyframes lvb-count-dim {
  0%, 100% { opacity: var(--current-opacity, 0.78); }
  50%      { opacity: 0.55; }
}
.lvb-count-falling {
  animation: lvb-count-dim 3s ease-in-out 2;
}
`;

/* ──────────────────────────────────────────────────────────────────
   MARKET MODE — Phase 4 "stock market for bars" bubble.
   Gated by FEATURE_FLAGS.MARKET_UX. Renders delta_pct as hero, with
   zoom-aware sizing, state-change ring, and trend-rate-synced pulse.
   ────────────────────────────────────────────────────────────────── */

// Phase 6 (Unify) — STATE_VISUALS is gone. Components resolve state
// tokens to var() references pointing at :root tokens declared in
// src/styles/palette.css. Update the palette globally → every
// consumer updates. HeatField, Ticker, and CityPulse route through
// the same vars in subsequent phases.
type StateKey = 'quiet' | 'lively' | 'busy' | 'packed' | 'surging' | 'unknown';

function stateKey(label: string): StateKey {
  const k = label.toLowerCase();
  if (k === 'quiet' || k === 'lively' || k === 'busy' ||
      k === 'packed' || k === 'surging') return k;
  return 'unknown';
}

function stateVars(label: string): {
  primary: string; border: string; text: string;
  glow: string; glowStrong: string; bg: string;
} {
  const k = stateKey(label);
  return {
    primary:    `var(--${k}-primary)`,
    border:     `var(--${k}-border)`,
    text:       `var(--${k}-text)`,
    glow:       `var(--${k}-glow)`,
    glowStrong: `var(--${k}-glow-strong)`,
    bg:         `var(--${k}-bg)`,
  };
}

// Phase 1 (Recon→Restore v2) — capsule geometry. The SVG border that
// doubles as the capacity gauge needs these exact dimensions for the
// dasharray perimeter math to align with the visible rounded-rect
// border. Width raised to 84 so the three stacked lines breathe.
const CAPSULE_W = 84;
const CAPSULE_H = 64;
const CAPSULE_R = 22;

// Rounded-rect perimeter, used as strokeDasharray for the capacity arc.
// Standard form: 2*(W − 2R) + 2*(H − 2R) straight sides + 2πR for the
// four quarter-circle corners combined.
const CAPSULE_PERIMETER =
  2 * (CAPSULE_W - 2 * CAPSULE_R)
  + 2 * (CAPSULE_H - 2 * CAPSULE_R)
  + 2 * Math.PI * CAPSULE_R;

/** Map zoom → display tier. Three buckets keep re-renders cheap —
 *  bubbles only repaint when crossing a threshold, not on every
 *  zoom tick. Phase 6 (Unify) lowered all thresholds by one step so
 *  pills appear sooner: wide < 11, mid 11–13, tight ≥ 14. */
type ZoomTier = 'wide' | 'mid' | 'tight';
function getZoomTier(zoom: number | undefined): ZoomTier {
  if (zoom == null) return 'mid';
  if (zoom < 11) return 'wide';
  if (zoom < 14) return 'mid';
  return 'tight';
}

/** Pulse cadence keyed off |trend_rate|. Faster movers pulse faster. */
function pulseRateFor(trendRate: number | null | undefined): string {
  if (trendRate == null) return '2s';
  const abs = Math.abs(trendRate);
  if (abs > 1.0) return '1.2s';
  if (abs > 0.5) return '2s';
  return '3.5s';
}

/** Capacity-ring outer diameter, sized to comfortably surround the
 *  bubble's visible shell at each zoom tier. Wide tier is a small ring
 *  around the 10 px dot; mid is a snug ring around the mid pill; tight
 *  is the full hero treatment. Phase 6 raised tight to 68 so the ring
 *  has more presence next to the capsule (and ungated its render). */
function getBubbleRingSize(zoom?: number): number {
  if (zoom == null) return 64;
  if (zoom < 11) return 38;
  if (zoom < 14) return 56;
  return 68;  // tight — ring stays prominent, complements capsule
}

/** Pulse-class keyed off |trend_rate|. Drives the breath halo's
 *  oscillation cycle so the map breathes faster around live movers. */
function getPulseClass(trendRate: number | null | undefined): string {
  if (trendRate == null) return 'lvb-pulse--slow';
  const mag = Math.abs(trendRate);
  if (mag > 1.0) return 'lvb-pulse--fast';
  if (mag > 0.5) return 'lvb-pulse--med';
  return 'lvb-pulse--slow';
}

/** First-character glyph for the bubble's mid-zoom identity treatment.
 *  Strips leading "The " articles so "The Bookstore" → "B" rather than
 *  "T". Empty → empty (no initial rendered). */
function getVenueInitial(name?: string): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  const noArticle = trimmed.replace(/^The\s+/i, '');
  return noArticle.charAt(0).toUpperCase();
}

function MarketLiveVenueBubbleInner({
  estimate, isSelected, onTap, highlighted, mapZoom, venueName,
  marketView, isSpotlight, movementMagnitude, showName, vibeHueBaseline,
}: LiveVenueBubbleProps) {
  const stateLabel = normalizeState(estimate?.state_label);
  const confidence = estimate?.confidence_pct ?? 0;
  const trend = estimate?.trend ?? null;
  const trendRate = estimate?.trend_rate ?? null;
  const pulseClass = getPulseClass(trendRate);
  const initial = getVenueInitial(venueName);

  // Phase 6 (Vibe) — hue identity comes from the founder-authored
  // baseline for the current time band. Saturation reads from
  // stateLabel; lightness reads from capacity_pct. The result is one
  // HSL value the rest of the bubble consumes via --vibe-color.
  const timeBand = useCurrentTimeBand();
  const vibeHueId = (vibeHueBaseline?.[timeBand] ?? null) as VibeHueId | null;
  const vibeColor = vibeToHsl(
    vibeHueId,
    stateLabel,
    estimate?.capacity_pct ?? null,
  );
  const vibeGlow = vibeToGlow(vibeHueId, stateLabel, 0.55);
  const vibeGlowStrong = vibeToGlow(vibeHueId, stateLabel, 0.75);

  // ─── State-change ring — fires once per transition into a new state.
  const prevStateRef = useRef<StateLabel>(stateLabel);
  const [ringKey, setRingKey] = useState(0);
  useEffect(() => {
    if (prevStateRef.current !== stateLabel) {
      prevStateRef.current = stateLabel;
      setRingKey(k => k + 1);
    }
  }, [stateLabel]);

  // Phase 6 — louder, second-layer state-change pulse. The 920ms
  // radial broadcast from bubble center, skipping Unknown ↔ anything
  // (those are first-mount artifacts). Pairs with the existing ring
  // above so real flips get a two-layered visible event.
  const prevPulseRef = useRef<StateLabel | null>(null);
  const [statePulse, setStatePulse] = useState(false);
  useEffect(() => {
    const prev = prevPulseRef.current;
    const curr = stateLabel;
    if (prev !== null && prev !== curr && curr !== 'Unknown' && prev !== 'Unknown') {
      setStatePulse(true);
      const t = setTimeout(() => setStatePulse(false), 920);
      prevPulseRef.current = curr;
      return () => clearTimeout(t);
    }
    prevPulseRef.current = curr;
  }, [stateLabel]);

  // Phase 6 — initial scales smoothly across the mid band so leaning
  // into the city feels like the letter is growing toward you. Linear
  // 0.9× at zoom 11 → 1.15× at zoom 13. Outside the mid band the value
  // is unused — React unmounts the initial via the conditional render.
  //
  // HOOK ORDER NOTE: This useMemo must run on EVERY render, including
  // renders where the algorithm-data guard below returns null. It used
  // to live after the guard, causing a Rules of Hooks violation when
  // estimate-presence toggled between renders — the crash that filled
  // 1.7.0's App Store crash logs. Don't move it back.
  const initialScale = useMemo(() => {
    const tierInline = getZoomTier(mapZoom);
    if (tierInline !== 'mid') return 1;
    const z = mapZoom ?? 12;
    const t = Math.max(0, Math.min(1, (z - 11) / 2));
    return 0.9 + t * 0.25;
  }, [mapZoom]);

  // No render when engine has nothing — same algorithm-run gate as legacy.
  if (!hasAlgorithmData(estimate)) return null;

  const tier = getZoomTier(mapZoom);
  // Phase 6 (Unify) — stateVars() returns var() references resolving
  // against :root tokens in src/styles/palette.css. The bubble's local
  // --state-* custom props point at those global tokens.
  const visuals = stateVars(stateLabel);
  const isSurging = stateLabel === 'Surging';
  const pulseRate = pulseRateFor(trendRate);
  // Trend is read for the breath-rate calc above and (currently) for
  // nothing else in this render path. Phase 1 moved all data into the
  // capsule; the bullet on the count line is the orientation cue.
  void trend;

  // Stagger BOLD entry by movement magnitude — biggest movers light
  // first (delay 0ms), smallest last (~600ms). Scoped via a CSS
  // variable so the always-on breath animation isn't delayed too.
  const mvDelayMs = marketView
    ? Math.round((1 - Math.min(1, Math.max(0, movementMagnitude ?? 0))) * 600)
    : 0;


  // Capacity gauge — Phase 1 collapses the separate concentric arc
  // into the capsule's own border at tight zoom. Clamped 0–1 for
  // display; over-capacity (≥1.0) gets a drop-shadow on the stroke.
  const capacityPct = estimate?.capacity_pct ?? null;
  const capacityClamped = Math.min(1, Math.max(0, capacityPct ?? 0));
  const capsuleDashOffset = CAPSULE_PERIMETER * (1 - capacityClamped);
  const capacityText = getCapacityText(capacityPct);
  const isOverCapacity = capacityPct != null && capacityPct >= 1.0;

  const rootStyle: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    display: 'inline-block',
    lineHeight: 0,
    position: 'relative',
    // CSS custom props consumed by the inline keyframes / classes.
    // These resolve against the :root tokens in palette.css via var().
    ['--state-primary' as string]:     visuals.primary,
    ['--state-border' as string]:      visuals.border,
    ['--state-text' as string]:        visuals.text,
    ['--state-glow' as string]:        visuals.glow,
    ['--state-glow-strong' as string]: visuals.glowStrong,
    ['--state-bg' as string]:          visuals.bg,
    ['--pulse-rate' as string]:        pulseRate,
    ['--mv-delay' as string]:          `${mvDelayMs}ms`,
    // Phase 6 (Vibe) — vibe-driven tokens. Bubble color identity now
    // routes through these. The --state-* tokens above remain for the
    // surfaces (state ring, mv overrides, market dot) that still key
    // off engine state rather than founder vibe.
    ['--vibe-color' as string]:        vibeColor,
    ['--vibe-glow' as string]:         vibeGlow,
    ['--vibe-glow-strong' as string]:  vibeGlowStrong,
  };

  // Tier-gated render flags.
  // - wide: just the breath halo + small core dot
  // - mid:  breath halo + initial in core (no capsule)
  // - tight: breath halo + Legacy-language capsule (with SVG border gauge)
  const showInitial = tier === 'mid' && initial.length > 0 && stateLabel !== 'Unknown';
  const showCapsule = tier === 'tight' && stateLabel !== 'Unknown' && confidence >= 35;
  const showWideDot = tier === 'wide';

  return (
    <motion.button
      type="button"
      onClick={onTap}
      className={[
        'lvb-bubble',
        'lvb-bubble--market',
        'lvb-bubble--breathing',
        pulseClass,
        `lvb-state-${stateLabel.toLowerCase()}`,
        `lvb-bubble--zoom-${tier}`,
        highlighted ? 'lvb-highlighted' : '',
        isSurging ? 'lvb-market-surging' : '',
        marketView ? 'lvb-bubble--mv' : '',
        marketView ? `lvb-bubble--mv-${stateLabel.toLowerCase()}` : '',
        marketView && isSpotlight ? 'lvb-bubble--spotlight' : '',
      ].filter(Boolean).join(' ')}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: isSelected ? 1.08 : 1 }}
      transition={isSelected
        ? { type: 'spring', stiffness: 300, damping: 18 }
        : { duration: 0.22, ease: 'easeOut' }}
      whileTap={{ scale: 0.95 }}
      style={rootStyle}
      aria-label={`${venueName ?? 'Venue'}: ${stateLabel}`}
    >
      {/* Breath halo — radial-gradient child element sitting behind
          everything. Its --pulse-cycle CSS variable comes from
          pulseClass (fast/med/slow), keyed off |trend_rate|. */}
      <span className="lvb-breath-halo" aria-hidden />

      {/* Phase 6 (Unify) — CapacityRing renders at ALL tiers. At tight
          zoom it complements the capsule's own SVG border gauge —
          two channels showing the same truth, both filling clockwise
          as capacity climbs. */}
      <CapacityRing
        capacityPct={capacityPct}
        color={vibeColor}
        glow={vibeGlow}
        size={getBubbleRingSize(mapZoom)}
        stroke={3}
        threshold={0.30}
      />

      {/* State-change broadcast ring — keyed so each state transition
          remounts the element and replays the keyframe. */}
      {ringKey > 0 && (
        <span
          key={ringKey}
          aria-hidden
          className="lvb-market-state-ring"
        />
      )}

      {/* Phase 6 — louder one-shot state-change pulse. Skips first
          mounts (Unknown ↔ anything). Across the city, every real
          state shift becomes a visible event. */}
      {statePulse && (
        <span className="lvb-state-pulse" aria-hidden />
      )}

      {showWideDot && (
        <span className="lvb-market-dot" aria-hidden />
      )}

      {showInitial && (
        <span
          className="lvb-initial lvb-initial--mid"
          style={{ fontSize: `calc(13px * ${initialScale})` }}
          aria-hidden
        >
          {initial}
        </span>
      )}

      {/* Phase 1 (Recon→Restore) — Legacy-language capsule. The pill is
          ONE element with an SVG border that doubles as the capacity
          gauge. STATUS caps on top, "• count" middle, language qualifier
          at the bottom. No separate concentric ring at tight tier. */}
      {showCapsule && (
        <div className="lvb-capsule">
          {/* SVG border that doubles as capacity gauge */}
          <svg
            className="lvb-capsule__gauge"
            width="100%"
            height="100%"
            viewBox={`0 0 ${CAPSULE_W} ${CAPSULE_H}`}
            preserveAspectRatio="none"
            aria-hidden
          >
            {/* track — faint base outline */}
            <rect
              x="1.25" y="1.25"
              width={CAPSULE_W - 2.5}
              height={CAPSULE_H - 2.5}
              rx={CAPSULE_R - 1.25}
              ry={CAPSULE_R - 1.25}
              fill="none"
              stroke="var(--state-border)"
              strokeOpacity="0.22"
              strokeWidth="2.5"
            />
            {/* fill — animated capacity arc. -90° rotation puts the
                start at the top of the capsule so it fills clockwise.
                Phase 6 — stroke and over-capacity drop-shadow read
                vibe tokens so the gauge color matches the bubble. */}
            <rect
              x="1.25" y="1.25"
              width={CAPSULE_W - 2.5}
              height={CAPSULE_H - 2.5}
              rx={CAPSULE_R - 1.25}
              ry={CAPSULE_R - 1.25}
              fill="none"
              stroke="var(--vibe-color)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={CAPSULE_PERIMETER}
              strokeDashoffset={capsuleDashOffset}
              style={{
                filter: isOverCapacity
                  ? `drop-shadow(0 0 6px var(--vibe-glow))`
                  : 'none',
                transition: 'stroke-dashoffset 600ms cubic-bezier(0.4,0,0.2,1)',
              }}
              transform={`rotate(-90 ${CAPSULE_W / 2} ${CAPSULE_H / 2})`}
            />
          </svg>

          {/* Capsule contents — three stacked lines */}
          <div className="lvb-capsule__inner">
            <span className="lvb-capsule__state">{stateLabel}</span>
            {estimate?.estimate != null && estimate.estimate >= 0 && (
              <span className="lvb-capsule__count">
                <span className="lvb-capsule__bullet" aria-hidden>•</span>
                {estimate.estimate}
              </span>
            )}
            {capacityText && (
              <span className="lvb-capsule__qualifier">{capacityText}</span>
            )}
          </div>
        </div>
      )}

      {/* Smart-density name label. Anchored below the bubble at
          mid/wide, or below the capsule at tight. Parent decides
          when to set showName via top-mover / proximity / spotlight
          / tight-zoom heuristics. */}
      {showName && venueName && (
        <span className={`lvb-name-label lvb-name-label--${tier}`}>{venueName}</span>
      )}

      <style>{LVB_KEYFRAMES}</style>
      <style>{LVB_MARKET_KEYFRAMES}</style>
    </motion.button>
  );
}

const LVB_MARKET_KEYFRAMES = `
.lvb-bubble--market {
  position: relative;
  font-family: var(--font-display);
}

/* Phase 1 — the kettlebell shell is gone. The mid-tier initial now
   floats on its own behind/over the breath halo; the tight-tier
   capsule lives in .lvb-capsule below. Only the wide-tier core dot
   stays from this section. */
.lvb-market-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--state-primary);
  box-shadow: 0 0 12px var(--state-glow);
  animation: lvb-market-dot-pulse 2.4s ease-in-out infinite;
}

@keyframes lvb-market-dot-pulse {
  0%, 100% { opacity: 0.75; transform: scale(1); }
  50%      { opacity: 1; transform: scale(1.18); }
}

.lvb-market-surging .lvb-market-dot {
  animation: lvb-market-dot-pulse 2.4s ease-in-out infinite,
             lvb-market-surge-halo 2.6s ease-in-out infinite;
}

@keyframes lvb-market-surge-halo {
  0%, 100% { box-shadow: 0 0 14px var(--state-glow), 0 0 28px rgba(31, 232, 154, 0.25); }
  50%      { box-shadow: 0 0 22px var(--state-glow), 0 0 42px rgba(31, 232, 154, 0.45); }
}

.lvb-bubble--market .lvb-trend-arrow {
  display: inline-block;
  margin-left: 6px;
  font-size: 0.85em;
  font-weight: 700;
  animation: lvb-trend-pulse var(--pulse-rate, 2s) ease-in-out infinite;
}

@keyframes lvb-trend-pulse {
  0%, 100% { opacity: 0.45; transform: scale(0.95); }
  50%      { opacity: 1;    transform: scale(1.1); }
}

.lvb-market-state-ring {
  content: '';
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  border: 2px solid var(--state-primary);
  opacity: 0;
  pointer-events: none;
  animation: lvb-state-change-ring 920ms cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes lvb-state-change-ring {
  0%   { opacity: 0.85; transform: scale(1);    }
  60%  { opacity: 0.5;  transform: scale(1.35); }
  100% { opacity: 0;    transform: scale(1.7);  }
}

/* Phase 6 — louder, secondary state-change pulse layer. Radial
   expansion from bubble center. Fires only on real state flips
   (Unknown ↔ anything is skipped as a first-mount artifact). */
.lvb-state-pulse {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid var(--state-primary);
  pointer-events: none;
  z-index: 4;
  animation: lvb-state-pulse-anim 920ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes lvb-state-pulse-anim {
  0%   { opacity: 0; transform: scale(1);    border-width: 2px;   }
  25%  { opacity: 1; transform: scale(1.05);                       }
  100% { opacity: 0; transform: scale(2.6);  border-width: 0.5px; }
}

@media (prefers-reduced-motion: reduce) {
  .lvb-state-pulse { animation: none; opacity: 0; }
}

.lvb-delta {
  font-family: var(--font-display);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  color: var(--state-text);
}

.lvb-delta--hero {
  font-size: 22px;
  text-shadow: 0 0 16px var(--state-glow);
}

.lvb-delta--mid {
  font-size: 14px;
}

.lvb-delta--zero {
  color: rgba(255, 255, 255, 0.5);
}

.lvb-bubble--market .lvb-state-text {
  font-weight: 540;
  font-size: 10.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--state-text);
  opacity: 0.85;
}

/* ──────────────────────────────────────────────────────────────
   MARKET VIEW MODE — BOLD transforms.
   Activated when MapView toggles \`marketView\` on the bubble.
   Stagger keyed off --mv-delay (set per-bubble by movement
   magnitude). Surging gets the double-ring broadcast; Quiet/Unknown
   fade back so the riser standouts pop.
   ────────────────────────────────────────────────────────────── */
.lvb-bubble--mv {
  animation: lvb-mv-enter 560ms cubic-bezier(0.16, 1, 0.3, 1) var(--mv-delay, 0ms) both;
  transform-origin: center;
}

@keyframes lvb-mv-enter {
  0%   { transform: scale(1);                    filter: saturate(1)   brightness(1);    }
  100% { transform: scale(var(--mv-scale, 1.18)); filter: saturate(1.5) brightness(1.15); }
}

.lvb-bubble--mv-surging { --mv-scale: 1.55; z-index: 25; }

.lvb-bubble--mv-surging::before {
  content: '';
  position: absolute;
  inset: -12px;
  border-radius: 50%;
  border: 2px solid #1FE89A;
  opacity: 0.85;
  animation: lvb-mv-surging-ring-1 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  pointer-events: none;
}

.lvb-bubble--mv-surging::after {
  content: '';
  position: absolute;
  inset: -12px;
  border-radius: 50%;
  border: 2px solid #1FE89A;
  opacity: 0.55;
  animation: lvb-mv-surging-ring-2 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  animation-delay: 1s;
  pointer-events: none;
}

@keyframes lvb-mv-surging-ring-1 {
  0%   { transform: scale(1);   opacity: 0.85; }
  100% { transform: scale(2.4); opacity: 0;    }
}

@keyframes lvb-mv-surging-ring-2 {
  0%   { transform: scale(1);   opacity: 0.55; }
  100% { transform: scale(2.8); opacity: 0;    }
}

.lvb-bubble--mv-packed  { --mv-scale: 1.35; }
.lvb-bubble--mv-busy    { --mv-scale: 1.25; }
.lvb-bubble--mv-lively  { --mv-scale: 1.12; }
.lvb-bubble--mv-quiet   { --mv-scale: 0.85; opacity: 0.4; }
.lvb-bubble--mv-unknown { --mv-scale: 0.78; opacity: 0.2; }

/* SPOTLIGHT — overrides scale + adds pulsing glow */
.lvb-bubble--spotlight {
  --mv-scale: 1.75 !important;
  z-index: 50;
  filter: saturate(1.8) brightness(1.35) drop-shadow(0 0 28px var(--state-glow));
  animation:
    lvb-mv-enter 560ms cubic-bezier(0.16, 1, 0.3, 1) var(--mv-delay, 0ms) both,
    lvb-spotlight-pulse 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes lvb-spotlight-pulse {
  0%, 100% { filter: saturate(1.8) brightness(1.35) drop-shadow(0 0 28px var(--state-glow)); }
  50%      { filter: saturate(2.1) brightness(1.55) drop-shadow(0 0 42px var(--state-glow)); }
}

@media (prefers-reduced-motion: reduce) {
  .lvb-bubble--mv,
  .lvb-bubble--mv-surging::before,
  .lvb-bubble--mv-surging::after,
  .lvb-bubble--spotlight {
    animation: none;
  }
}

/* ──────────────────────────────────────────────────────────────
   Phase 5.1 — breath halo. Implemented as a child <span> rather
   than a ::before pseudo because Phase 4.7's market-view surging
   rings already claim ::before AND ::after on the bubble root.
   The halo oscillates opacity + a gentle scale on a cycle keyed
   off |trend_rate| so the map breathes faster around live movers.
   ────────────────────────────────────────────────────────────── */
.lvb-breath-halo {
  content: '';
  position: absolute;
  /* Phase 6 — halo extends 22px BELOW the bubble so at tight zoom
     (capsule only 4px away) the breath glow bleeds into the capsule
     glow area. Pair reads as one luminous organism. Vibe tokens own
     the halo color so the breath itself carries founder identity. */
  inset: -10px -10px -22px -10px;
  border-radius: 50%;
  background: radial-gradient(
    ellipse 60% 75% at 50% 40%,
    var(--vibe-glow-strong) 0%,
    var(--vibe-glow) 35%,
    transparent 70%
  );
  pointer-events: none;
  z-index: 0;
  animation: lvb-breath var(--pulse-cycle, 3.5s) ease-in-out infinite;
  opacity: 0.6;
  transition: background 480ms cubic-bezier(0.4, 0, 0.2, 1);
}

.lvb-pulse--fast { --pulse-cycle: 1.2s; }
.lvb-pulse--med  { --pulse-cycle: 2.0s; }
.lvb-pulse--slow { --pulse-cycle: 3.5s; }

@keyframes lvb-breath {
  0%, 100% { opacity: 0.5;  transform: scale(1);    }
  50%      { opacity: 0.95; transform: scale(1.06); }
}

/* Unknown state — honest dead-air. Halo holds steady at low opacity. */
.lvb-state-unknown .lvb-breath-halo {
  animation: none;
  opacity: 0.15;
}

@media (prefers-reduced-motion: reduce) {
  .lvb-breath-halo { animation: none; opacity: 0.7; }
}

/* ──────────────────────────────────────────────────────────────
   Phase 5.1/5.2 — venue initial in bubble core. Brand-orange weight
   800 so it stays legible against any state fill. Only rendered at
   the mid zoom tier (12–14) via plain conditional render; inline
   font-size is applied per-frame so the initial grows smoothly
   across the band.
   ────────────────────────────────────────────────────────────── */
.lvb-initial {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: 14px;
  color: #FF8200;
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.6),
    0 0 8px rgba(0, 0, 0, 0.3);
  letter-spacing: -0.02em;
  pointer-events: none;
  line-height: 1.0;
  /* Phase 5.2.1 — plain CSS fade-in on mount. React unmounts when zoom
     leaves mid; the keyframe runs once on each new mount so the letter
     never overlaps the pill (which is gated on tight). */
  animation: lvb-fade-in 220ms cubic-bezier(0.4, 0, 0.2, 1) both;
}

@keyframes lvb-fade-in {
  0%   { opacity: 0; transform: scale(0.88); }
  100% { opacity: 1; transform: scale(1);    }
}

/* ──────────────────────────────────────────────────────────────
   Phase 5.1/5.2 — smart-density name labels. Anchored just below
   the bubble (mid/wide) or below the data pill (tight). The parent
   only sets showName for venues that deserve a label.
   ────────────────────────────────────────────────────────────── */
.lvb-name-label {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.78);
  white-space: nowrap;
  text-shadow:
    0 1px 4px rgba(0, 0, 0, 0.85),
    0 0 6px rgba(0, 0, 0, 0.6);
  pointer-events: none;
  letter-spacing: -0.005em;
  z-index: 3;
  transition: top 280ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* Tight zoom — capsule is 64px tall + 4px top gap + 10px buffer.
   Phase 6 lowered this from 84px → 78px to match the closed gap. */
.lvb-name-label--tight { top: calc(100% + 78px); }
.lvb-name-label--mid,
.lvb-name-label--wide  { top: calc(100% + 6px); }

/* ──────────────────────────────────────────────────────────────
   Phase 1 (Recon→Restore) — Legacy-language capsule.
   The pill is ONE element with an SVG border that doubles as the
   capacity gauge. Dimensions are LOCKED to match CAPSULE_W /
   CAPSULE_H / CAPSULE_R constants so the dasharray perimeter math
   in the render aligns to the visible rounded-rect border.
   ────────────────────────────────────────────────────────────── */
.lvb-capsule {
  position: absolute;
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  width: 84px;
  height: 64px;
  pointer-events: none;
  z-index: 3;
  animation: lvb-capsule-rise 320ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.lvb-capsule__gauge {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}

.lvb-capsule__inner {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 9px 14px 10px;
  border-radius: 22px;
  /* Phase 6 — deep-tinted glass. The dark gradient sits on top of the
     vibe color with multiply blend, so the hue shows through faintly
     while the surface stays dark enough for white text to land. Safe
     across Safari/Chrome/Firefox (no relative-color syntax). */
  background:
    linear-gradient(180deg, rgba(8, 8, 14, 0.92) 0%, rgba(4, 4, 8, 0.96) 100%),
    var(--vibe-color);
  background-blend-mode: multiply;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow:
    0 8px 22px rgba(0, 0, 0, 0.55),
    0 -4px 18px var(--vibe-glow),
    0 0 22px var(--vibe-glow-strong),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  z-index: 2;
  font-family: var(--font-display);
  white-space: nowrap;
  transition:
    background 480ms cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 480ms cubic-bezier(0.4, 0, 0.2, 1);
}

.lvb-capsule__state {
  font-weight: 700;
  font-size: 8.5px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--state-text);
  line-height: 1.0;
  opacity: 0.95;
}

.lvb-capsule__count {
  font-weight: 800;
  font-size: 20px;
  letter-spacing: -0.025em;
  font-variant-numeric: tabular-nums;
  color: #FFFFFF;
  text-shadow:
    0 0 14px var(--vibe-glow),
    0 0 4px var(--vibe-glow-strong);
  line-height: 1.0;
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
}

.lvb-capsule__bullet {
  font-size: 13px;
  color: var(--vibe-color);
  font-weight: 800;
  text-shadow: 0 0 10px var(--vibe-glow-strong);
  position: relative;
  top: -2px;
}

.lvb-capsule__qualifier {
  font-weight: 600;
  font-size: 9.5px;
  color: rgba(255, 255, 255, 0.68);
  letter-spacing: 0.03em;
  line-height: 1.0;
}

/* Market view boost — saturated, glowing harder. The whole inner
   block lifts in saturation by ~18% and the glow shadow extends.
   Phase 6 — glow routes vibe so the lift carries founder color. */
.lvb-bubble--mv .lvb-capsule__inner {
  filter: saturate(1.18);
  box-shadow:
    0 8px 26px rgba(0, 0, 0, 0.6),
    0 0 28px var(--vibe-glow),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

@keyframes lvb-capsule-rise {
  0%   { opacity: 0; transform: translateX(-50%) translateY(-4px) scale(0.94); }
  100% { opacity: 1; transform: translateX(-50%) translateY(0)    scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .lvb-initial,
  .lvb-capsule { animation: none; }
}

/* ──────────────────────────────────────────────────────────────
   Phase 6 — intensified explore-mode color grading. The map looks
   vivid even before Market View activates. Market View still feels
   like a step-up, but the baseline is alive.
   ────────────────────────────────────────────────────────────── */
.lvb-bubble--market {
  filter: saturate(1.08);
  transition:
    filter 480ms cubic-bezier(0.4, 0, 0.2, 1),
    background-color 480ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 480ms cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 480ms cubic-bezier(0.4, 0, 0.2, 1);
}

.lvb-bubble--market.lvb-bubble--mv {
  filter: saturate(1.22);
}
`;

const LegacyLiveVenueBubble = memo(LegacyLiveVenueBubbleInner);
const MarketLiveVenueBubble = memo(MarketLiveVenueBubbleInner);

/** Public export. Branches by feature flag at runtime — both paths
 *  share the same prop shape so callers don't care which is active. */
export function LiveVenueBubble(props: LiveVenueBubbleProps) {
  if (FEATURE_FLAGS.MARKET_UX) {
    return <MarketLiveVenueBubble {...props} />;
  }
  return <LegacyLiveVenueBubble {...props} />;
}
