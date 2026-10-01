import { ChevronLeft, Crown } from 'lucide-react';
import { useVenueBoard } from '../../hooks/useVenueBoard';
import { hapticLight } from '../../lib/haptics';
import { CommunityAvatar } from './CommunityAvatar';
import type { BarOwnershipRow } from '../../hooks/useBarOwnership';

const FONT = 'Satoshi, sans-serif';
const GOLD = '#FFD24A';

function medalColor(rank: number): string {
  if (rank === 1) return GOLD;
  if (rank === 2) return '#C7CBD1';
  if (rank === 3) return '#E08A4B';
  return 'var(--text-muted)';
}

interface VenueBoardPanelProps {
  venue: BarOwnershipRow;
  onBack: () => void;
}

/**
 * Per-bar drill-down — full ranked visitor list off useVenueBoard.
 * Ties are shown honestly: venue_leaderboard's rank() gives every tied
 * row venueRank=1 (e.g. LunaVerse's koza/dthomp/brbit), so every row
 * at rank 1 gets a crown here, even though the wall's summary row
 * above resolves the tie to a single owner via first_claimed_at.
 */
export function VenueBoardPanel({ venue, onBack }: VenueBoardPanelProps) {
  const { rows, loading } = useVenueBoard(venue.venueId);

  return (
    <div>
      <button
        type="button"
        onClick={() => { hapticLight(); onBack(); }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          background: 'transparent', border: 'none', color: 'var(--text-secondary)',
          fontFamily: FONT, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          padding: '4px 0 12px', WebkitTapHighlightColor: 'transparent',
        }}
      >
        <ChevronLeft size={16} /> All bars
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <div
          style={{
            width: 56, height: 56, borderRadius: 12, flexShrink: 0, overflow: 'hidden',
            background: '#1A1A22',
            backgroundImage: venue.imageUrl ? `url(${venue.imageUrl})` : undefined,
            backgroundSize: 'cover', backgroundPosition: 'center 35%',
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FONT, fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>
            {venue.name}
          </div>
          <div
            style={{
              fontFamily: FONT, fontSize: 11, color: venue.owner ? GOLD : 'var(--text-muted)',
              fontWeight: venue.owner ? 800 : 500, display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            {venue.owner && <Crown size={12} />}
            {venue.owner
              ? `${venue.owner.displayName || venue.owner.username} owns this bar`
              : 'Unclaimed — be the first'}
          </div>
        </div>
      </div>

      <div style={{ height: 1, background: 'var(--border-subtle)', margin: '10px 0 14px' }} />

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)', fontFamily: FONT, fontSize: 13 }}>
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontFamily: FONT, fontSize: 13 }}>
          No regulars yet — be the first to own it.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {rows.map((r) => {
            const top3 = r.venueRank <= 3;
            const name = r.displayName || r.username;
            return (
              <div
                key={r.profileId}
                style={{
                  display: 'flex', alignItems: 'center', gap: 11,
                  padding: top3 ? '11px 12px' : '9px 11px', borderRadius: 13,
                  background: top3 ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.025)',
                  border: `1px solid ${top3 ? 'rgba(255,210,74,0.22)' : 'var(--border-subtle)'}`,
                }}
              >
                <span
                  style={{
                    width: 26, textAlign: 'center', fontFamily: FONT,
                    fontSize: top3 ? 17 : 14, fontWeight: 900, color: medalColor(r.venueRank), flexShrink: 0,
                  }}
                >
                  {r.venueRank}
                </span>
                <CommunityAvatar
                  name={name}
                  color={r.avatarColor}
                  size={top3 ? 40 : 34}
                  ring={top3 ? medalColor(r.venueRank) : undefined}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    {r.venueRank === 1 && <Crown size={13} style={{ color: GOLD, flexShrink: 0 }} />}
                    <span
                      style={{
                        fontFamily: FONT, fontSize: top3 ? 15 : 14, fontWeight: 700, color: 'var(--text-primary)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}
                    >
                      {name}
                    </span>
                  </div>
                  <div style={{ fontFamily: FONT, fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                    {r.visitCount} {r.visitCount === 1 ? 'visit' : 'visits'} · {r.distinctNights} {r.distinctNights === 1 ? 'night' : 'nights'}
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: FONT, fontSize: top3 ? 15 : 13, fontWeight: 800,
                    color: top3 ? '#FFE0B8' : 'var(--text-secondary)', flexShrink: 0,
                  }}
                >
                  {r.venueScore.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
