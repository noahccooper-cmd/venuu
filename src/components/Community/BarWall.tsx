import { Crown } from 'lucide-react';
import { useBarOwnership, type BarOwnershipRow } from '../../hooks/useBarOwnership';
import { CommunityAvatar } from './CommunityAvatar';

const FONT = 'Satoshi, sans-serif';
const GOLD = '#FFD24A';

function BarRow({ bar }: { bar: BarOwnershipRow }) {
  const { owner } = bar;
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 12px', borderRadius: 13,
        background: owner
          ? 'linear-gradient(135deg, rgba(255,210,74,0.12), rgba(255,130,0,0.04))'
          : 'rgba(255,255,255,0.025)',
        border: `1px ${owner ? 'solid' : 'dashed'} ${owner ? 'rgba(255,210,74,0.4)' : 'rgba(255,210,74,0.22)'}`,
      }}
    >
      <div
        style={{
          width: 46, height: 46, borderRadius: 10, flexShrink: 0, overflow: 'hidden',
          background: '#1A1A22',
          backgroundImage: bar.imageUrl ? `url(${bar.imageUrl})` : undefined,
          backgroundSize: 'cover', backgroundPosition: 'center 35%',
        }}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: FONT, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {bar.name}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, minWidth: 0 }}>
          {owner ? (
            <>
              <Crown size={14} style={{ color: GOLD, flexShrink: 0 }} />
              <CommunityAvatar name={owner.displayName || owner.username} color={owner.avatarColor} size={20} />
              <span
                style={{
                  fontFamily: FONT, fontSize: 13, fontWeight: 700, color: '#FFE0B8',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
                }}
              >
                {owner.displayName || owner.username}
              </span>
              <span style={{ fontFamily: FONT, fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>
                · {owner.visitCount} {owner.visitCount === 1 ? 'visit' : 'visits'}
              </span>
            </>
          ) : (
            <>
              <Crown size={14} style={{ color: 'rgba(255,210,74,0.5)', flexShrink: 0 }} />
              <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: GOLD, flexShrink: 0 }}>
                Unclaimed
              </span>
              <span style={{ fontFamily: FONT, fontSize: 12, color: 'var(--text-muted)' }}>
                — be the first
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The Knoxville bar wall — a clean, non-interactive display registry.
 * Every bar with its #1 regular as "owner," or an unclaimed
 * invitation state. Deliberately no tap/expand — VenueBoardPanel
 * (the per-bar drill-down this used to open) is intentionally left
 * intact and unused for now; it's being relocated onto bar profile
 * pages as a separate next step, not deleted.
 */
export function BarWall() {
  const { bars, loading, error } = useBarOwnership();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '4px 0 10px' }}>
        <span style={{ width: 3, height: 15, borderRadius: 2, background: GOLD }} />
        <Crown size={14} style={{ color: GOLD }} />
        <span
          style={{
            fontFamily: FONT, fontSize: 11, fontWeight: 800, letterSpacing: '0.13em',
            color: 'var(--text-primary)', textTransform: 'uppercase',
          }}
        >
          Who owns Knoxville
        </span>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontFamily: FONT, fontSize: 13 }}>
          Loading…
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontFamily: FONT, fontSize: 13 }}>
          Couldn't load the bar wall.
        </div>
      ) : bars.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontFamily: FONT, fontSize: 13 }}>
          No bars yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {bars.map((bar) => (
            <BarRow key={bar.venueId} bar={bar} />
          ))}
        </div>
      )}
    </div>
  );
}
