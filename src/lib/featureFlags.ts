/**
 * Feature flags — toggle expensive or in-flight surface area without
 * shipping a separate code path. Each flag reads from a Vite env var
 * so a `.env` change + rebuild flips the experience for everyone.
 *
 * MARKET_UX gates the Phase 4 "stock market for bars" rendering:
 * city pulse line, delta-pct bubbles, and Tonight's Movers drawer.
 * When false, the app renders the legacy bubble visuals.
 */
export const FEATURE_FLAGS = {
  MARKET_UX: import.meta.env.VITE_MARKET_UX_ENABLED === 'true',
} as const;
