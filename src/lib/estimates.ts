import type { HeadcountEstimate } from '../hooks/useVenuesInBounds';

/**
 * headcount_estimates is keyed on venue_id (PRIMARY KEY + FK to venues),
 * so PostgREST treats the venues → headcount_estimates embed as
 * one-to-one and returns an OBJECT (or null), not an array. Every reader
 * in the app expects `headcount_estimates: HeadcountEstimate[]`, so the
 * object shape was silently dropped and bubbles waited for the next
 * realtime fusion tick (0–60s) to get their numbers.
 *
 * Normalise at every ingestion point (fetch, realtime, cache) to the
 * array shape the readers use.
 */
export function normalizeEstimates(raw: unknown): HeadcountEstimate[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean).map(toEstimate);
  if (typeof raw === 'object') return [toEstimate(raw)];
  return [];
}

/** First (only) estimate for a venue, tolerating either embed shape. */
export function getEstimate(venue: { headcount_estimates?: unknown }): HeadcountEstimate | undefined {
  const raw = venue.headcount_estimates;
  if (Array.isArray(raw)) return raw[0];
  if (raw && typeof raw === 'object') return raw as HeadcountEstimate;
  return undefined;
}

function num(v: unknown, fallback = 0): number {
  return v === null || v === undefined ? fallback : Number(v);
}

function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** Coerce a raw row (REST or realtime payload) to the estimate columns we use. */
export function toEstimate(raw: unknown): HeadcountEstimate {
  const r = raw as Record<string, unknown>;
  return {
    estimate: num(r.estimate),
    estimate_low: num(r.estimate_low),
    estimate_high: num(r.estimate_high),
    confidence_pct: num(r.confidence_pct),
    capacity_pct: numOrNull(r.capacity_pct),
    state_label: String(r.state_label ?? 'Unknown'),
    trend: r.trend === null || r.trend === undefined ? null : String(r.trend),
    trend_rate: numOrNull(r.trend_rate),
    computed_at: String(r.computed_at ?? new Date().toISOString()),
    source_breakdown: (r.source_breakdown as Record<string, unknown> | null) ?? null,
    delta_pct: numOrNull(r.delta_pct),
    expected_pct: numOrNull(r.expected_pct),
  };
}

/** True when two estimates would render identically. */
export function sameEstimate(a: HeadcountEstimate | undefined, b: HeadcountEstimate | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.estimate === b.estimate
    && a.estimate_low === b.estimate_low
    && a.estimate_high === b.estimate_high
    && a.confidence_pct === b.confidence_pct
    && a.capacity_pct === b.capacity_pct
    && a.state_label === b.state_label
    && a.trend === b.trend
    && a.trend_rate === b.trend_rate
    && a.computed_at === b.computed_at
    && a.delta_pct === b.delta_pct
    && a.expected_pct === b.expected_pct
    && JSON.stringify(a.source_breakdown) === JSON.stringify(b.source_breakdown);
}
