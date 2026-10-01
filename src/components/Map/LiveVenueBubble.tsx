import { memo, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { HeadcountEstimate } from '../../hooks/useVenuesInBounds';
import { getCoverLabel } from '../../lib/utils';
import { DAYTIME_BUBBLE_MODE, getLiveWindow, liveFromLabel } from '../../lib/estimates';
import { RollingNumber, ROLLING_NUMBER_CSS } from './RollingNumber';

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
  /** False outside the fusion window (21:00–06:59 UTC) or before tonight's
   *  first tick for this venue — the estimate is last night's, not live.
   *  Rendering then follows DAYTIME_BUBBLE_MODE. Defaults to true. */
  live?: boolean;
  /** Numbers came from the on-device cache and a refresh is in flight. */
  updating?: boolean;
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

function getCountGlyph(estimate: number | null, tier: ConfTier): string | null {
  if (estimate == null || estimate < 0) return null;
  // Sharp + soft both use the regular dot — soft's uncertainty comes
  // from italic + reduced opacity, not punctuation. Tilde is reserved
  // for tentative so it reads exclusively as "lower confidence".
  if (tier === 'sharp')     return '· ';
  if (tier === 'soft')      return '· ';
  if (tier === 'tentative') return '~ ';
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
 *   manual_curve       — operator-authored capacity curve (PRIMARY baseline)
 *   besttime_live      — live busyness from BestTime, last 90 min
 *   besttime_forecast  — current-hour BestTime forecast curve
 *   bouncer_override   — manual headcount click in the last 60 min
 *   category_default   — fallback heuristic (no real signal)
 *   no_data            — sentinel for "we have absolutely nothing"
 *
 * The first four are the algorithm actually doing work; the last two
 * are guesses. We render bubbles only for those four so the map
 * doesn't lie about venues we have no data for.
 */
const ALGORITHM_SOURCES = new Set([
  'besttime_live',
  'besttime_forecast',
  'bouncer_override',
  'manual_curve',
]);

function hasAlgorithmData(estimate: HeadcountEstimate | null | undefined): boolean {
  if (!estimate) return false;
  const src = estimate.source_breakdown?.baseline_source;
  return typeof src === 'string' && ALGORITHM_SOURCES.has(src);
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

/**
 * Bloom wrapper — present only during the cinematic intro's
 * bubble-bloom phase. Its transform doesn't compete with framer's
 * inline transforms on the inner motion.button because framer
 * operates one DOM level deeper.
 *
 * Declared at module level: when it was declared inside the bubble,
 * every render created a new component type, so React remounted the
 * whole bubble on every update and replayed its fade-in from 0.
 */
function BloomOuter({ delayMs, children }: { delayMs: number | null; children: React.ReactNode }) {
  // Always the same element so the bubble isn't remounted when the
  // bloom ends; `display: contents` makes it layout-neutral meanwhile.
  return delayMs !== null
    ? <div className="lvb-intro-bloom" style={{ animationDelay: `${delayMs}ms` }}>{children}</div>
    : <div style={{ display: 'contents' }}>{children}</div>;
}

// Shared bubble CSS, injected once rather than as a <style> per bubble.
let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const el = document.createElement('style');
  el.setAttribute('data-lvb', '');
  el.textContent = LVB_KEYFRAMES + ROLLING_NUMBER_CSS;
  document.head.appendChild(el);
}

function LegacyLiveVenueBubbleInner({ venueId, estimate, coverCharge, isSelected, onTap, introBloomDelay, highlighted, live = true, updating = false }: LiveVenueBubbleProps) {
  ensureStyles();
  const useBloom = (introBloomDelay ?? 0) >= 0 && introBloomDelay !== undefined && introBloomDelay > -1;
  // Only opt into the bloom class when a delay was explicitly provided
  // AND non-negative. Once the parent stops passing the prop the class
  // disappears on the next render and subsequent prop changes don't
  // re-trigger the keyframe (forwards-fill keeps the final state).
  const bloomEnabled = useBloom && typeof introBloomDelay === 'number';
  const bloomDelayMs = bloomEnabled ? Math.max(0, introBloomDelay!) : null;
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
  const trendClass = useTrendClass(live ? trend : null);

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

  // Not live → last night's row. Never present it as tonight's numbers.
  //   'live-from'  — neutral bubble, no numbers: "Live from 5 PM"
  //                  (or "Live soon" inside the window, before tonight's
  //                  first fusion tick has landed for this venue).
  //   'last-night' — dimmed bubble, last night's figure, "Last night".
  const daytime = !live;
  const liveFrom = daytime && DAYTIME_BUBBLE_MODE === 'live-from';
  const lastNight = daytime && DAYTIME_BUBBLE_MODE === 'last-night';
  const inWindow = daytime && getLiveWindow().inWindow;

  const v = liveFrom ? DAYTIME_VISUALS : visualsFor(stateLabel);

  // Signature-display content
  const tier = getConfTier(confidence);
  const countValue = estimate?.estimate ?? 0;
  const countGlyph = liveFrom ? null : getCountGlyph(countValue, tier);
  const capacityText = daytime ? null : getCapacityText(capacityPct);
  const countPrefix = daytime ? '' : getCountPrefix(estimate?.source_breakdown);
  const isBouncerVerified = countPrefix.length > 0;
  const isSurging = !daytime && stateLabel === 'Surging';
  const isOverCap = capacityPct !== null && capacityPct >= 1.0;
  const headline = liveFrom
    ? (inWindow ? 'Live soon' : 'Live from')
    : lastNight ? 'Last night' : stateLabel;
  const liveFromTime = liveFrom && !inWindow ? liveFromLabel() : null;

  // ─── Confidence → light, not lines ───
  // High: no border, inset glow tinted to bubble. Medium: 1px @ 30%
  // edge tint. Low: no border, soft outer halo at 20%.
  let borderCss: string = 'none';
  let baseShadow: string;

  if (liveFrom) {
    borderCss = `1px solid ${v.edge}`;
    baseShadow = '0 2px 8px rgba(0,0,0,0.3)';
  } else if (isSurging) {
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
    (isSurging ? 'lvb-bubble lvb-surging' : 'lvb-bubble') +
    (lastNight ? ' lvb-last-night' : '');

  return (
    <BloomOuter delayMs={bloomDelayMs}>
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
        className={`${stateClass} ${trendClass}`.trim()}
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
            key={headline}
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 2 }}
            transition={{ duration: 0.18 }}
            className={`lvb-content${isSurging ? ' lvb-surging-stack' : ''}${updating && !daytime ? ' lvb-updating' : ''}`}
          >
            <div className="lvb-state">{headline}</div>

            {liveFromTime && (
              <div className="lvb-count lvb-count-sharp">{liveFromTime}</div>
            )}

            {countGlyph && (
              <div
                className={
                  `lvb-count lvb-count-${tier}` +
                  (isBouncerVerified ? ' lvb-verified' : '') +
                  (trend === 'rising'  ? ' lvb-count-rising'  : '') +
                  (trend === 'falling' ? ' lvb-count-falling' : '') +
                  (tapped ? ' lvb-tapped' : '')
                }
              >
                {countPrefix}{countGlyph}<RollingNumber value={countValue} />
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

    </motion.button>
    </BloomOuter>
  );
}

/** Neutral daytime bubble ("Live from 5 PM") — no state colour. */
const DAYTIME_VISUALS: StateVisuals = {
  background: 'rgba(22, 22, 28, 0.82)',
  textColor: '#A9A9B4',
  edge: '#34343C',
};

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

/* Cached numbers on screen while the refresh is in flight. */
.lvb-updating .lvb-count,
.lvb-updating .lvb-capacity {
  opacity: 0.5;
}

/* Option (a) daytime: last night's figure, visibly not live. */
.lvb-last-night {
  opacity: 0.55;
  filter: saturate(0.45);
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

/** Public export. */
export const LiveVenueBubble = memo(LegacyLiveVenueBubbleInner);
