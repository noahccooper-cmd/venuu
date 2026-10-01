import { ChevronRight, Crown, TrendingDown, TrendingUp } from 'lucide-react';
import { useVenuuRank } from '../../hooks/useVenuuRank';
import type { CommunityLeaderboardRow } from '../../hooks/useCommunityLeaderboard';

const FONT = 'Satoshi, sans-serif';
const GOLD = '#FFD24A';

interface YourVenuuHeroProps {
  profileId: string | null;
  /** Same Knoxville-local rows the podium/board bubble use — read for
   *  the local rank number beneath the score (see note on score below). */
  rows: CommunityLeaderboardRow[];
  onSignIn?: () => void;
}

function MovementRow({ delta }: { delta: number | null }) {
  if (delta == null || delta === 0) return null;
  const up = delta > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      color: up ? '#37E1A0' : '#FF5E7A', fontFamily: FONT, fontSize: 13, fontWeight: 800,
    }}>
      <Icon size={14} strokeWidth={2.5} />{Math.abs(delta)}
    </span>
  );
}

const cardShell: React.CSSProperties = {
  position: 'relative',
  textAlign: 'center',
  padding: '22px 20px 20px',
  borderRadius: 20,
  marginBottom: 18,
  overflow: 'hidden',
};

/**
 * The Venuu # hero — the centerpiece at the top of the Community tab.
 * The score (venuu_score) is the headline number: it's a per-user
 * value, not city-scoped, so useVenuuRank.score is correct here
 * regardless of whether the user is found in the Knoxville-local
 * `rows` window. The rank badge beneath IS city-scoped, so that part
 * still reads from `rows` (see useCommunityLeaderboard's localRank
 * doc comment) rather than useVenuuRank's global rank.
 */
export function YourVenuuHero({ profileId, rows, onSignIn }: YourVenuuHeroProps) {
  const { score, delta, excluded, loading } = useVenuuRank(profileId);

  if (!profileId) {
    return (
      <button
        type="button"
        onClick={onSignIn}
        style={{
          ...cardShell,
          width: '100%', cursor: onSignIn ? 'pointer' : 'default',
          WebkitTapHighlightColor: 'transparent',
          background: 'rgba(255,255,255,0.025)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ fontFamily: FONT, fontSize: 10, fontWeight: 800, letterSpacing: '0.16em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          Your Venuu #
        </div>
        <div style={{ fontFamily: FONT, fontSize: 56, fontWeight: 900, lineHeight: 1.05, letterSpacing: '-0.03em', color: 'var(--text-faded)', margin: '4px 0' }}>
          —
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: FONT, fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
          Sign in to get your Venuu # <ChevronRight size={14} />
        </div>
      </button>
    );
  }

  if (excluded) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '11px 14px', borderRadius: 13, marginBottom: 18,
        background: 'rgba(255,210,74,0.06)', border: '1px solid rgba(255,210,74,0.18)',
      }}>
        <Crown size={16} style={{ color: GOLD, flexShrink: 0 }} />
        <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
          You're the host — hidden from the board
        </span>
      </div>
    );
  }

  if (loading) {
    return <div style={{ ...cardShell, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', minHeight: 140 }} />;
  }

  const myRow = rows.find(r => r.profileId === profileId);

  return (
    <div
      style={{
        ...cardShell,
        background: 'linear-gradient(180deg, rgba(255,210,74,0.10) 0%, rgba(255,130,0,0.02) 100%)',
        border: '1px solid rgba(255,210,74,0.28)',
      }}
    >
      <div
        style={{
          position: 'absolute', top: '50%', left: '50%', width: 220, height: 220,
          transform: 'translate(-50%, -50%)', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,210,74,0.22) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', fontFamily: FONT, fontSize: 10, fontWeight: 800, letterSpacing: '0.16em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
        Your Venuu #
      </div>
      <div
        style={{
          position: 'relative', fontFamily: FONT, fontSize: 60, fontWeight: 900,
          lineHeight: 1.05, letterSpacing: '-0.03em', color: GOLD, margin: '4px 0',
          textShadow: '0 0 24px rgba(255,210,74,0.4)',
        }}
      >
        {score.toLocaleString()}
      </div>

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        {myRow ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: FONT, fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>
            <Crown size={13} style={{ color: GOLD }} />
            #{myRow.localRank} in Knoxville
          </span>
        ) : (
          <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
            Climbing the Knoxville board
          </span>
        )}
        <MovementRow delta={delta} />
      </div>
    </div>
  );
}
