import { memo } from 'react';
import { CheckCircle } from 'lucide-react';

/**
 * PlanCard — visual timeline of a night plan that Venny composed.
 * Rendered inline inside an assistant message bubble (Venny narrates
 * the plan in prose, the card surfaces the structure underneath).
 *
 * Each stop is a row: orange dot on the left, vertical connector line
 * to the next stop, and a content block on the right with the time /
 * cost / duration meta, the venue name, and a short vibe note.
 *
 * Tapping a stop is handled by the MapView's numbered route markers
 * (rendered as DOM elements at each stop's coordinates) — this card
 * is intentionally non-interactive on the stop rows so the user has
 * a clear divide: "read it here, fly there from the map".
 */

export interface PlanStop {
  venue_id: string;
  venue_name: string;
  lat: number;
  lng: number;
  arrival_time: string;
  duration_min: number;
  vibe_note?: string | null;
  estimated_cost?: number | null;
  /** Canonical arrival timestamp — set by tap or by the proximity
   *  detector's ENTER event. Persisted onto night_plans.stops[i]
   *  for saved plans. */
  arrived_at?: string | null;
  /** Set when the user hold-skipped this stop. */
  skipped_at?: string | null;
  /** Set on the final stop when the user taps "end the night". */
  completed_at?: string | null;
  /** true if arrival was a user tap, false/null if proximity detector
   *  auto-credited the visit. */
  confirmed_manually?: boolean | null;
  /** Set when the user advances past this stop to the next. */
  left_at?: string | null;
  /** Legacy alias — older client wrote this. Read as a fallback when
   *  arrived_at is absent. */
  visited_at?: string | null;
}

export interface Plan {
  title: string;
  summary?: string | null;
  vibe_tags?: string[] | null;
  stops: PlanStop[];
  total_estimated_cost?: number | null;
  total_duration_min?: number | null;
  start_time?: string | null;
  end_time?: string | null;
}

interface PlanCardProps {
  plan: Plan;
  onSave: () => void;
  onShare: () => void;
  /** Fires when the user taps LETS GO — parent enters plan mode
   *  (cinematic activation: Venny dismisses, PlanSheet opens). */
  onActivate: () => void;
  saved: boolean;
  saving: boolean;
  /** Indices of stops the proximity detector has confirmed visited. */
  visitedStopIndices?: number[];
}

function PlanCardInner({ plan, onSave, onShare, onActivate, saved, saving, visitedStopIndices }: PlanCardProps) {
  const visitedSet = new Set(visitedStopIndices ?? []);
  const totalCost = typeof plan.total_estimated_cost === 'number' ? plan.total_estimated_cost : null;
  const totalDuration = typeof plan.total_duration_min === 'number' ? plan.total_duration_min : null;
  const hours = totalDuration != null ? Math.floor(totalDuration / 60) : null;
  const mins = totalDuration != null ? totalDuration % 60 : null;

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 340,
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 130, 0, 0.25)',
        borderRadius: 14,
        padding: 16,
        boxShadow: '0 6px 20px rgba(0, 0, 0, 0.3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Title + summary */}
      <div>
        <div style={{
          fontFamily: 'Satoshi, sans-serif',
          fontSize: 17,
          fontWeight: 700,
          color: 'white',
          letterSpacing: '-0.01em',
          lineHeight: 1.2,
        }}>
          {plan.title}
        </div>
        {plan.summary && (
          <div style={{
            marginTop: 4,
            fontFamily: 'Satoshi, sans-serif',
            fontSize: 12,
            fontStyle: 'italic',
            color: 'rgba(255, 255, 255, 0.55)',
            lineHeight: 1.4,
          }}>
            {plan.summary}
          </div>
        )}
      </div>

      <div style={{ height: 1, background: 'rgba(255, 130, 0, 0.18)' }} />

      {/* Stops timeline */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {plan.stops.map((stop, i) => {
          const isLast = i === plan.stops.length - 1;
          // A stop counts as visited if it's flagged in the live
          // visited-indices set (in-memory) OR if night_plans persisted
          // an arrived_at timestamp (re-opened from My Plans). Legacy
          // plans wrote visited_at — fall back to that.
          const visited = visitedSet.has(i) || !!stop.arrived_at || !!stop.visited_at;
          return (
            <div key={`${stop.venue_id}-${i}`} style={{ display: 'flex', gap: 12 }}>
              {/* Left rail: numbered orange dot — stays in place;
               *  green CheckCircle adornment appears to its right
               *  when visited so the visual hierarchy is preserved
               *  (the dot itself is the timeline anchor, the check
               *  is a small completion stamp). */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                flexShrink: 0,
                width: 26,
                position: 'relative',
              }}>
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    background: '#FF8200',
                    boxShadow: '0 0 8px rgba(255, 130, 0, 0.45)',
                    marginTop: 2,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'Satoshi, sans-serif',
                    fontSize: 10, fontWeight: 800,
                    color: 'white',
                    lineHeight: 1,
                  }}
                >
                  {i + 1}
                </div>
                {visited && (
                  <span
                    aria-label="Visited"
                    style={{
                      position: 'absolute',
                      top: -2,
                      left: 14,
                      width: 16, height: 16,
                      borderRadius: 8,
                      background: '#0A0A10',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <CheckCircle size={14} strokeWidth={2.4} color="#00CC66" />
                  </span>
                )}
                {!isLast && (
                  <div
                    style={{
                      width: 1,
                      flex: 1,
                      minHeight: 28,
                      background: visited
                        ? 'rgba(0, 204, 102, 0.4)'
                        : 'rgba(255, 130, 0, 0.4)',
                      marginTop: 4,
                      marginBottom: 4,
                    }}
                  />
                )}
              </div>

              {/* Stop content */}
              <div style={{ flex: 1, paddingBottom: isLast ? 0 : 14 }}>
                {/* Meta row: time · cost · duration */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontFamily: 'Satoshi, sans-serif',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'rgba(255, 255, 255, 0.55)',
                  letterSpacing: '0.01em',
                }}>
                  <span>{stop.arrival_time}</span>
                  {stop.estimated_cost != null && (
                    <>
                      <span style={{ opacity: 0.5 }}>·</span>
                      <span>~${stop.estimated_cost}</span>
                    </>
                  )}
                  {stop.duration_min != null && (
                    <>
                      <span style={{ opacity: 0.5 }}>·</span>
                      <span>{stop.duration_min} min</span>
                    </>
                  )}
                  {visited && (
                    <>
                      <span style={{ opacity: 0.5 }}>·</span>
                      <span style={{ color: '#00CC66', fontWeight: 700 }}>visited</span>
                    </>
                  )}
                </div>

                {/* Venue name */}
                <div style={{
                  marginTop: 2,
                  fontFamily: 'Satoshi, sans-serif',
                  fontSize: 14,
                  fontWeight: 700,
                  color: 'white',
                  letterSpacing: '-0.01em',
                }}>
                  {stop.venue_name}
                </div>

                {/* Vibe note */}
                {stop.vibe_note && (
                  <div style={{
                    marginTop: 2,
                    fontFamily: 'Satoshi, sans-serif',
                    fontSize: 11,
                    fontStyle: 'italic',
                    color: 'rgba(255, 255, 255, 0.55)',
                    lineHeight: 1.35,
                  }}>
                    {stop.vibe_note}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ height: 1, background: 'rgba(255, 130, 0, 0.18)' }} />

      {/* Total + actions */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        fontFamily: 'Satoshi, sans-serif',
        fontSize: 12,
        fontWeight: 600,
        color: 'rgba(255, 255, 255, 0.75)',
      }}>
        <span>
          TOTAL:
          {totalCost != null && ` ~$${totalCost} / person`}
          {hours != null && (mins ? ` · ${hours}h ${mins}m` : ` · ${hours}h`)}
        </span>
      </div>

      {/* LETS GO — primary CTA. Activates plan mode (cinematic takeover) */}
      <button
        type="button"
        onClick={onActivate}
        aria-label="Activate plan"
        style={{
          width: '100%',
          padding: '14px 20px',
          marginBottom: 10,
          borderRadius: 12,
          border: 'none',
          background: 'linear-gradient(135deg, #FF8200 0%, #FF6B1A 100%)',
          color: '#000',
          fontFamily: 'Satoshi, sans-serif',
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: 0.5,
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
          boxShadow: '0 4px 16px rgba(255, 130, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.1) inset',
          transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        }}
        onMouseDown={(e) => {
          e.currentTarget.style.transform = 'scale(0.98)';
        }}
        onMouseUp={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
        }}
      >
        LETS GO
      </button>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={onSave}
          disabled={saved || saving}
          aria-label={saved ? 'Plan saved' : 'Save plan'}
          style={{
            flex: 1,
            padding: '8px 16px',
            borderRadius: 18,
            background: saved
              ? 'rgba(0, 200, 120, 0.18)'
              : saving
                ? 'rgba(255, 130, 0, 0.6)'
                : '#FF8200',
            border: saved
              ? '1px solid rgba(0, 200, 120, 0.45)'
              : 'none',
            color: saved ? '#62FFC4' : 'white',
            fontFamily: 'Satoshi, sans-serif',
            fontSize: 13,
            fontWeight: 700,
            cursor: saved || saving ? 'default' : 'pointer',
            WebkitTapHighlightColor: 'transparent',
            transition: 'background 200ms ease-out, color 200ms ease-out',
          }}
        >
          {saved ? '✓ saved' : saving ? 'saving…' : 'save plan'}
        </button>
        <button
          type="button"
          onClick={onShare}
          aria-label="Share plan"
          style={{
            flex: 1,
            padding: '8px 16px',
            borderRadius: 18,
            background: 'transparent',
            border: '1px solid #FF8200',
            color: '#FF8200',
            fontFamily: 'Satoshi, sans-serif',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          share
        </button>
      </div>
    </div>
  );
}

export const PlanCard = memo(PlanCardInner);
