import { Trophy } from 'lucide-react';

const FONT = 'Satoshi, sans-serif';

/**
 * CommunityPage — the Community tab's persistent shell. First-class
 * consumer destination (Map / Community / You), not an overlay.
 * Content lands section by section (global rank hero, bar-ownership
 * wall, per-venue drill-down) on top of this shell — see
 * useCommunityLeaderboard / useBarOwnership / useVenueBoard / useVenuuRank.
 */
export function CommunityPage() {
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
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 100px)',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <Trophy size={32} style={{ color: 'var(--text-faded)', marginBottom: 10 }} />
          <p style={{ fontFamily: FONT, fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            The leaderboard and bar-ownership wall land here next.
          </p>
        </div>
      </div>
    </div>
  );
}
