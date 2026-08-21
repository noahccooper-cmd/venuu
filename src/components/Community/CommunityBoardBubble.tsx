import { useEffect, useRef } from 'react';
import { CommunityAvatar } from './CommunityAvatar';
import type { CommunityLeaderboardRow } from '../../hooks/useCommunityLeaderboard';

const FONT = 'Satoshi, sans-serif';

interface CommunityBoardBubbleProps {
  rows: CommunityLeaderboardRow[];
  loading: boolean;
  meProfileId: string | null;
}

/** Rows fade out at the panel's top/bottom edges instead of cutting
 *  off hard, both at rest and mid-scroll — the "flick through a
 *  physical stack" feel. mask-image is WebKit-native (Safari and
 *  Capacitor iOS both support -webkit-mask-image), which is this
 *  app's actual runtime, so no fallback needed. */
const EDGE_FADE = 'linear-gradient(to bottom, transparent 0, black 18px, black calc(100% - 18px), transparent 100%)';

/** ~5 rows visible (50px row + 7px gap each) plus a sliver of the 6th
 *  peeking under the fade, as an affordance that there's more below. */
const BUBBLE_MAX_HEIGHT = 300;

/**
 * The scrollable "bubble" — rank 4 onward, sitting directly below the
 * podium like a pedestal base. Ranks 4-5 are just the top two rows
 * inside it now, not a separate static section. A narrow, inset,
 * self-contained panel (generous black margin both sides, clearly
 * not edge-to-edge) with its own lifted background/shadow and a soft
 * edge fade, so it reads as a distinct tactile module rather than a
 * plain scrolling div. If the signed-in user falls in this range,
 * their row is highlighted and auto-scrolled into view once the
 * board loads — the retention hook: everyone finds themselves in
 * the pack.
 */
export function CommunityBoardBubble({ rows, loading, meProfileId }: CommunityBoardBubbleProps) {
  const rest = rows.slice(3);
  const meRowRef = useRef<HTMLDivElement | null>(null);
  const hasAutoScrolledRef = useRef(false);

  useEffect(() => {
    if (hasAutoScrolledRef.current) return;
    if (loading || rest.length === 0) return;
    if (meRowRef.current) {
      meRowRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
      hasAutoScrolledRef.current = true;
    }
  }, [loading, rest.length]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontFamily: FONT, fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  if (rest.length === 0) return null;

  return (
    <div style={{ margin: '16px 40px 0' }}>
      <div
        style={{
          maxHeight: BUBBLE_MAX_HEIGHT,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          borderRadius: 18,
          padding: '10px 8px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.09)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.3)',
          maskImage: EDGE_FADE,
          WebkitMaskImage: EDGE_FADE,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {rest.map((r) => {
            const isMe = r.profileId === meProfileId;
            const name = r.displayName || r.username;
            return (
              <div
                key={r.profileId}
                ref={isMe ? meRowRef : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 11,
                  padding: '9px 11px', borderRadius: 13,
                  background: isMe ? 'var(--brand-orange-tint)' : 'rgba(255,255,255,0.035)',
                  border: `1px solid ${isMe ? 'var(--brand-orange-tint-strong)' : 'var(--border-subtle)'}`,
                }}
              >
                <span style={{ width: 30, textAlign: 'center', fontFamily: FONT, fontSize: 13, fontWeight: 900, color: 'var(--text-muted)', flexShrink: 0 }}>
                  {r.localRank}
                </span>
                <CommunityAvatar name={name} color={r.avatarColor} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      fontFamily: FONT, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block',
                    }}
                  >
                    {name}{isMe ? ' · you' : ''}
                  </span>
                </div>
                <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 800, color: 'var(--text-secondary)', flexShrink: 0 }}>
                  {r.venuuScore.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
