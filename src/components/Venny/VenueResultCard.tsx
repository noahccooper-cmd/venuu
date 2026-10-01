import { memo } from 'react';

/**
 * VenueResultCard — inline rich card that Venny drops into chat
 * messages after `search_venues`. Tapping the card collapses the
 * sheet and flies the map camera to the venue.
 *
 * Visual: dark glass tile with a colored state chip, capacity %,
 * "why this matches" reasoning, and a small cover hint when present.
 * The state chip color mirrors the LiveVenueBubble palette so a user
 * scanning the map after the highlight recognizes the same vibe.
 */

export interface VenueResult {
  id: string;
  name: string;
  lng?: number | null;
  lat?: number | null;
  state_label: 'Quiet' | 'Lively' | 'Busy' | 'Packed' | 'Surging' | 'Unknown' | string;
  capacity_pct?: number | null;
  estimate?: number | null;
  confidence_pct?: number | null;
  cover?: string | null;
  vibe_tags?: string[];
  why_match?: string | null;
}

interface VenueResultCardProps {
  venue: VenueResult;
  onTap: () => void;
}

interface StateVisuals {
  bg: string;
  fg: string;
  ring: string;
}

function visualsFor(state: string): StateVisuals {
  switch (state) {
    case 'Quiet':
      return { bg: 'rgba(94, 68, 128, 0.18)', fg: '#C9B4E0', ring: 'rgba(94, 68, 128, 0.45)' };
    case 'Lively':
      return { bg: 'rgba(184, 134, 47, 0.18)', fg: '#F2D58A', ring: 'rgba(184, 134, 47, 0.45)' };
    case 'Busy':
      return { bg: 'rgba(139, 58, 32, 0.18)', fg: '#FFC1A6', ring: 'rgba(139, 58, 32, 0.5)' };
    case 'Packed':
      return { bg: 'rgba(107, 21, 37, 0.22)', fg: '#FFAEBE', ring: 'rgba(107, 21, 37, 0.55)' };
    case 'Surging':
      return { bg: 'rgba(31, 232, 154, 0.10)', fg: '#80FFC8', ring: 'rgba(31, 232, 154, 0.45)' };
    case 'Unknown':
    default:
      return { bg: 'rgba(255, 255, 255, 0.05)', fg: 'rgba(255,255,255,0.55)', ring: 'rgba(255,255,255,0.15)' };
  }
}

function VenueResultCardInner({ venue, onTap }: VenueResultCardProps) {
  const visuals = visualsFor(venue.state_label);
  const capacityPct = typeof venue.capacity_pct === 'number'
    ? Math.round(venue.capacity_pct * 100)
    : null;
  const coverLabel = formatCover(venue.cover);

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`Open ${venue.name} on the map`}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '12px 14px',
        borderRadius: 14,
        background: 'rgba(20, 20, 28, 0.85)',
        border: `1px solid ${visuals.ring}`,
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {/* Top row: name + state chip */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{
          fontFamily: 'Satoshi, sans-serif',
          fontSize: 15, fontWeight: 700,
          color: 'white',
          letterSpacing: '-0.01em',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {venue.name}
        </span>
        <span style={{
          padding: '3px 9px',
          borderRadius: 10,
          background: visuals.bg,
          color: visuals.fg,
          fontFamily: 'Satoshi, sans-serif',
          fontSize: 11, fontWeight: 700,
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
          border: `1px solid ${visuals.ring}`,
          flexShrink: 0,
        }}>
          {venue.state_label}
        </span>
      </div>

      {/* Why match */}
      {venue.why_match && (
        <div style={{
          fontFamily: 'Satoshi, sans-serif',
          fontSize: 13,
          color: 'rgba(255,255,255,0.72)',
          lineHeight: 1.35,
        }}>
          {venue.why_match}
        </div>
      )}

      {/* Footer: capacity + cover */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        marginTop: 2,
      }}>
        {capacityPct != null && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontFamily: 'Satoshi, sans-serif',
            fontSize: 12, fontWeight: 600,
            color: 'rgba(255,255,255,0.6)',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: 3,
              background: visuals.fg,
              opacity: 0.9,
            }} />
            {capacityPct}% capacity
          </span>
        )}
        {coverLabel && (
          <span style={{
            fontFamily: 'Satoshi, sans-serif',
            fontSize: 12, fontWeight: 600,
            color: coverLabel === 'FREE' ? '#62FFC4' : 'rgba(255,255,255,0.6)',
          }}>
            {coverLabel}
          </span>
        )}
        <span style={{
          marginLeft: 'auto',
          fontFamily: 'Satoshi, sans-serif',
          fontSize: 12, fontWeight: 600,
          color: '#FF8200',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          show on map
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M3 2 L7 5 L3 8" stroke="#FF8200" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    </button>
  );
}

function formatCover(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^free$/i.test(trimmed)) return 'FREE';
  return trimmed;
}

export const VenueResultCard = memo(VenueResultCardInner);
