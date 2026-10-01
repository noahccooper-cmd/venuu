import { Trophy } from 'lucide-react';
import { useCommunityLeaderboard } from '../hooks/useCommunityLeaderboard';
import { YourVenuuHero } from '../components/Community/YourVenuuHero';
import { CommunityPodium } from '../components/Community/CommunityPodium';
import { CommunityBoardBubble } from '../components/Community/CommunityBoardBubble';
import { BarWall } from '../components/Community/BarWall';

const FONT = 'Satoshi, sans-serif';

/** Board caps at top 100, not the full Knoxville roster — the podium
 *  (1-3) slices off the front; everything from rank 4 on lives in
 *  CommunityBoardBubble's own scrollable container, which finds and
 *  auto-scrolls to the signed-in user if they're in range. */
const BOARD_SIZE = 100;

interface CommunityPageProps {
  profileId: string | null;
  onOpenSignIn?: () => void;
}

/**
 * CommunityPage — the Community tab's persistent shell. First-class
 * consumer destination (Map / Community / You), not an overlay.
 *
 * Descends personal -> aspirational -> the race -> the bars:
 *   1. YourVenuuHero — the Venuu # hero, first thing seen
 *   2. CommunityPodium — top 3, the lit-stage centerpiece
 *   3. CommunityBoardBubble — rank 4+, narrow scrollable pedestal
 *      base sitting directly beneath the podium, find yourself here
 *   4. BarWall — who owns Knoxville
 *
 * One useCommunityLeaderboard(BOARD_SIZE) call feeds 1-3 so the rank
 * numbers a user sees in the hero, podium, and board are always the
 * same consistent snapshot.
 */
export function CommunityPage({ profileId, onOpenSignIn }: CommunityPageProps) {
  const { rows, loading } = useCommunityLeaderboard(BOARD_SIZE);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--bg-page)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 16px',
          // Clears the app-level fixed Header (venuu wordmark + city
          // toggle) — +56px is the established offset for content
          // sitting below it, per EventScrubber.tsx.
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)',
          borderBottom: '1px solid var(--border-hairline)',
          flexShrink: 0,
        }}
      >
        <Trophy size={18} style={{ color: '#FFD24A' }} />
        <span
          style={{
            fontFamily: FONT,
            fontSize: 16,
            fontWeight: 800,
            color: 'var(--text-primary)',
            letterSpacing: '-0.01em',
          }}
        >
          Community
        </span>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '16px 16px 0',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 100px)',
        }}
      >
        <YourVenuuHero profileId={profileId} rows={rows} onSignIn={onOpenSignIn} />

        <CommunityPodium rows={rows} loading={loading} meProfileId={profileId} />
        <CommunityBoardBubble rows={rows} loading={loading} meProfileId={profileId} />

        {/* Clear break between "the board" (hero/podium/4-5/bubble,
         *  one continuous ranked list) and the bar registry below —
         *  bigger gap here than anywhere within the board itself. */}
        <div style={{ height: 34 }} />

        {/* ── Bar wall — who owns Knoxville ────────────────────── */}
        <BarWall />
      </div>
    </div>
  );
}
