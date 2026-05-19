/**
 * Bubble interpretation engine.
 *
 * Client-side template logic that turns a venue's current state into
 * a single human sentence — the headline-supporting copy on the
 * bubble card (Phase 5.2 wires it in). The output is meant to read
 * like a friend describing the room, not a stock ticker.
 *
 * Templates mix against three inputs:
 *   - state     ('Surging' | 'Packed' | 'Busy' | 'Lively' | 'Quiet' | 'Unknown')
 *   - deltaPct  (signed % vs the venue's own forecast; can be null)
 *   - dayOfWeek (0–6, JS standard; optional — fallback phrase otherwise)
 *
 * Confidence is the truth floor: anything under 35 returns the
 * honest "reading is light" fallback rather than asserting a vibe
 * we can't back. Surging at low confidence still falls into the
 * Unknown branch — we don't claim "going off" without conviction.
 *
 * Venny also imports this so chat and bubble share interpretation
 * language. The signature is stable so Phase 5.x can swap to a
 * Venny-generated implementation without touching consumers.
 */

export type StateLabel = 'Surging' | 'Packed' | 'Busy' | 'Lively' | 'Quiet' | 'Unknown';

export interface InterpretBubbleInput {
  state: StateLabel;
  deltaPct: number | null;
  confidence: number;
  /** 0=Sunday … 6=Saturday (JS standard). When omitted, falls back to
   *  a generic "a typical night" phrasing. */
  dayOfWeek?: number;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Returns a single-sentence interpretation of a venue's current
 * state. Always returns a string — never null/undefined.
 */
export function interpretBubble(input: InterpretBubbleInput): string {
  const { state, deltaPct, confidence, dayOfWeek } = input;
  const day = (dayOfWeek != null && dayOfWeek >= 0 && dayOfWeek <= 6)
    ? DAY_NAMES[dayOfWeek]
    : null;
  const dayPhrase = day ? `a typical ${day}` : 'a typical night';

  // Truth floor — never bluff under low confidence.
  if (confidence < 35 || state === 'Unknown') {
    return "Reading is light right now — check back as the night picks up.";
  }

  // Surging — the breakout state. Scales by delta intensity.
  if (state === 'Surging') {
    if (deltaPct != null && deltaPct >= 100) return `Going off right now — more than double ${dayPhrase}.`;
    if (deltaPct != null && deltaPct >= 60)  return `Lit up tonight — way above ${dayPhrase}.`;
    return `Running hot above ${dayPhrase}.`;
  }

  // Packed — peak intensity.
  if (state === 'Packed') {
    if (deltaPct != null && deltaPct >= 30) return `Packed and outperforming ${dayPhrase}.`;
    if (deltaPct != null && deltaPct >= 0)  return `At capacity for ${dayPhrase}.`;
    return `Packed — full house tonight.`;
  }

  // Busy — engaged, peak hours.
  if (state === 'Busy') {
    if (deltaPct != null && deltaPct >= 20)  return `Busier than ${dayPhrase} would suggest.`;
    if (deltaPct != null && deltaPct >= 0)   return `On pace for ${dayPhrase}.`;
    if (deltaPct != null && deltaPct <= -15) return `Busy but a touch below ${dayPhrase}.`;
    return `Busy — solid energy in the room.`;
  }

  // Lively — warming up, comfortable.
  if (state === 'Lively') {
    if (deltaPct != null && deltaPct >= 15)  return `Warming up — running ahead of ${dayPhrase}.`;
    if (deltaPct != null && deltaPct >= 0)   return `Lively — about where ${dayPhrase} sits.`;
    if (deltaPct != null && deltaPct <= -20) return `Comfortable but slower than ${dayPhrase}.`;
    return `Lively — easy to slide in.`;
  }

  // Quiet — resting, honest.
  if (state === 'Quiet') {
    if (deltaPct != null && deltaPct <= -50) return `Quieter than ${dayPhrase} — easy room to breathe.`;
    if (deltaPct != null && deltaPct <= -20) return `Slow tonight compared to ${dayPhrase}.`;
    return `Quiet — calm pace right now.`;
  }

  // Defensive fallback — unreachable given the state union, but safe.
  return `${state} — reading is honest.`;
}
