/**
 * Plan-execution design tokens — single source of truth for the
 * visual language of the night-companion experience.
 *
 * Three locked decisions live here:
 *   1. State-driven palette  — accent hue follows the current
 *      stop's live state so colour is information, not decoration.
 *   2. Liquid arrival motif  — the arrival celebration uses the
 *      same accent through its fluid waves.
 *   3. Variable typography   — weight choreography (light → hero)
 *      over the medium beat for headline moments.
 *
 * NEVER inline these values in components. Always import.
 */

export interface StateAccent {
  primary: string;
  glow: string;
  glowDim: string;
  fluid: string;
  label: string;
  cssVar: string;
}

// ─────────────────────────────────────────────────────────────
//  State palette — one entry per state_label the engine emits.
// ─────────────────────────────────────────────────────────────

export const stateAccents = {
  surging: {
    primary: '#FF7A1A',
    glow: 'rgba(255, 122, 26, 0.45)',
    glowDim: 'rgba(255, 122, 26, 0.18)',
    fluid: 'rgba(255, 122, 26, 0.32)',
    label: '#FFB37A',
    cssVar: '--state-surging',
  },
  lively: {
    primary: '#FF9542',
    glow: 'rgba(255, 149, 66, 0.42)',
    glowDim: 'rgba(255, 149, 66, 0.16)',
    fluid: 'rgba(255, 149, 66, 0.30)',
    label: '#FFC18A',
    cssVar: '--state-lively',
  },
  busy: {
    primary: '#FFAE5B',
    glow: 'rgba(255, 174, 91, 0.38)',
    glowDim: 'rgba(255, 174, 91, 0.14)',
    fluid: 'rgba(255, 174, 91, 0.28)',
    label: '#FFCFA0',
    cssVar: '--state-busy',
  },
  packed: {
    primary: '#FF5A3C',
    glow: 'rgba(255, 90, 60, 0.45)',
    glowDim: 'rgba(255, 90, 60, 0.18)',
    fluid: 'rgba(255, 90, 60, 0.32)',
    label: '#FF927A',
    cssVar: '--state-packed',
  },
  quiet: {
    primary: '#8A6FAE',
    glow: 'rgba(138, 111, 174, 0.35)',
    glowDim: 'rgba(138, 111, 174, 0.13)',
    fluid: 'rgba(138, 111, 174, 0.26)',
    label: '#B8A4D4',
    cssVar: '--state-quiet',
  },
  unknown: {
    primary: '#FF8200',
    glow: 'rgba(255, 130, 0, 0.30)',
    glowDim: 'rgba(255, 130, 0, 0.10)',
    fluid: 'rgba(255, 130, 0, 0.22)',
    label: '#FFAA55',
    cssVar: '--state-unknown',
  },
} satisfies Record<string, StateAccent>;

export type StateKey = keyof typeof stateAccents;

/**
 * Resolve a free-form state_label string into an accent palette.
 * Case-insensitive, trims whitespace; unknown labels fall back to
 * the brand orange so the UI never reads "broken" mid-state.
 */
export function accentForState(stateLabel: string | null | undefined): StateAccent {
  if (!stateLabel) return stateAccents.unknown;
  const key = stateLabel.toLowerCase().trim() as StateKey;
  return stateAccents[key] ?? stateAccents.unknown;
}

// ─────────────────────────────────────────────────────────────
//  Timing — every animation duration centralised so beats compose.
// ─────────────────────────────────────────────────────────────

export const timing = {
  /** Tap feedback / micro state changes. */
  microInstant: 120,
  /** Button press response, small fades. */
  microFast: 200,
  /** Standard small UI transitions. */
  microStandard: 320,
  /** Stop card state transitions, card morphs. */
  beatSlow: 520,
  /** Hero typography choreography, modal-card scale-in. */
  beatMedium: 720,
  /** Liquid arrival expansion. */
  beatLong: 1200,
  /** Full arrival ceremony from haptic to fade-out. */
  beatCeremonial: 2200,
  /** Framer Motion spring presets — drop into transition props. */
  spring: { mass: 1, stiffness: 220, damping: 24 },
  springSnappy: { mass: 0.8, stiffness: 320, damping: 22 },
  springSoft: { mass: 1.2, stiffness: 180, damping: 26 },
} as const;

// ─────────────────────────────────────────────────────────────
//  Easing curves — referenced from CSS via cubic-bezier().
// ─────────────────────────────────────────────────────────────

export const ease = {
  /** Smooth deceleration for general motion. */
  out: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
  /** Dramatic deceleration for hero arrivals. */
  outExpo: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** Standard in/out for non-hero moments. */
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  /** Gentle overshoot for badges + spring entries. */
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  /** Liquid expansion curve — slow start, smooth tail. */
  liquid: 'cubic-bezier(0.22, 1, 0.36, 1)',
} as const;

// ─────────────────────────────────────────────────────────────
//  Typography weights — choreographed from `ghost` to `monolith`.
//  The Satoshi @import in index.css ships 300/400/500/700/900;
//  intermediate values fall back to the nearest static face.
// ─────────────────────────────────────────────────────────────

export const typeWeight = {
  ghost: 200,
  light: 300,
  regular: 420,
  medium: 540,
  bold: 720,
  hero: 880,
  monolith: 940,
} as const;
