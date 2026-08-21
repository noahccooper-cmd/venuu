import { Crown } from 'lucide-react';
import { CommunityAvatar } from './CommunityAvatar';
import type { CommunityLeaderboardRow } from '../../hooks/useCommunityLeaderboard';

const FONT = 'Satoshi, sans-serif';
const GOLD = '#FFD24A';
const SILVER = '#C7CBD1';
const BRONZE = '#E08A4B';

interface PodiumSlotProps {
  row: CommunityLeaderboardRow;
  place: 1 | 2 | 3;
  isMe: boolean;
}

const PLACE_COLOR: Record<1 | 2 | 3, string> = { 1: GOLD, 2: SILVER, 3: BRONZE };
const PLACE_AVATAR_SIZE: Record<1 | 2 | 3, number> = { 1: 92, 2: 56, 3: 56 };
const PLACE_STAND_HEIGHT: Record<1 | 2 | 3, number> = { 1: 88, 2: 42, 3: 30 };

/** Entrance choreography — a small reveal sequence, not a simultaneous
 *  pop. Flanks settle first, gold lands last with a deliberate beat,
 *  then a one-shot "bloom" flourish fires on #1 right as it lands,
 *  handing off seamlessly into the continuous breathing glow once the
 *  bloom finishes. All timings below are derived, not duplicated, so
 *  the handoff between animations can never drift out of sync. */
const ENTRANCE_MS = 640;
const PLACE_DELAY_MS: Record<1 | 2 | 3, number> = { 2: 0, 3: 130, 1: 280 };
const FIRST_SETTLE_MS = PLACE_DELAY_MS[1] + ENTRANCE_MS; // avatar fully risen in
const BLOOM_MS = 650;
const CONTINUOUS_START_MS = FIRST_SETTLE_MS + BLOOM_MS; // bloom hands off to the loop

function PodiumSlot({ row, place, isMe }: PodiumSlotProps) {
  const color = PLACE_COLOR[place];
  const name = row.displayName || row.username;
  const isFirst = place === 1;

  return (
    <div
      className="community-podium-slot"
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        width: isFirst ? 116 : 88, flexShrink: 0,
        animationDelay: `${PLACE_DELAY_MS[place]}ms`,
      }}
    >
      {isFirst && (
        <Crown
          size={30}
          className="community-podium-crown"
          style={{
            color: GOLD, marginBottom: 5,
            filter: 'drop-shadow(0 0 5px rgba(255,210,74,0.5))',
            animationDelay: `${CONTINUOUS_START_MS}ms`,
          }}
        />
      )}

      <div style={{ position: 'relative' }}>
        {isFirst ? (
          <>
            {/* One-shot arrival flourish — fires once #1 has risen in,
             *  then hands off to the continuous breathing layer below
             *  at the exact instant it ends (see CONTINUOUS_START_MS). */}
            <div
              className="community-podium-bloom"
              style={{
                position: 'absolute', inset: -22, borderRadius: '50%',
                background: `radial-gradient(circle, ${GOLD}55 0%, transparent 70%)`,
                pointerEvents: 'none', animationDelay: `${FIRST_SETTLE_MS}ms`,
              }}
            />
            {/* Continuous breathing glow — a slow radiant swell, alive
             *  not flashing. Starts exactly where the bloom leaves off. */}
            <div
              className="community-podium-glow-pulse"
              style={{
                position: 'absolute', inset: -22, borderRadius: '50%',
                background: `radial-gradient(circle, ${GOLD}55 0%, transparent 70%)`,
                pointerEvents: 'none', animationDelay: `${CONTINUOUS_START_MS}ms`,
              }}
            />
          </>
        ) : (
          // #2/#3 — quiet static aura so medal color reads even when
          // their own avatar_color happens to match (frequently
          // orange in real data), no animation, gold stays the star.
          <div
            style={{
              position: 'absolute', inset: -9, borderRadius: '50%',
              background: `radial-gradient(circle, ${color}33 0%, transparent 70%)`,
              pointerEvents: 'none',
            }}
          />
        )}
        <CommunityAvatar name={name} color={row.avatarColor} size={PLACE_AVATAR_SIZE[place]} ring={color} />
      </div>

      <span
        style={{
          fontFamily: FONT, fontSize: isFirst ? 16 : 13, fontWeight: 800,
          color: isMe ? 'var(--brand-orange)' : 'var(--text-primary)',
          marginTop: 9, maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      >
        {name}{isMe ? ' · you' : ''}
      </span>
      <span style={{ fontFamily: FONT, fontSize: isFirst ? 16 : 13, fontWeight: 900, color, marginTop: 1 }}>
        {row.venuuScore.toLocaleString()}
      </span>

      {/* Podium stand — decorative pedestal. #1 tallest with a richer
       *  gradient; all three get an inset top highlight so they read
       *  as lit 3D pedestals rather than flat rectangles. */}
      <div
        style={{
          marginTop: 10, width: '100%', height: PLACE_STAND_HEIGHT[place],
          borderRadius: '12px 12px 0 0',
          background: isFirst
            ? `linear-gradient(180deg, ${GOLD}66 0%, ${GOLD}30 45%, rgba(255,130,0,0.10) 100%)`
            : `linear-gradient(180deg, ${color}3D 0%, ${color}16 100%)`,
          border: `1px solid ${color}${isFirst ? '80' : '66'}`,
          borderBottom: 'none',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 6,
        }}
      >
        <span style={{ fontFamily: FONT, fontSize: isFirst ? 23 : 17, fontWeight: 900, color }}>
          {place}
        </span>
      </div>
    </div>
  );
}

interface CommunityPodiumProps {
  rows: CommunityLeaderboardRow[];
  loading: boolean;
  meProfileId: string | null;
}

/**
 * The podium — top 3 Knoxville climbers as a lit-stage hero visual,
 * not a list. #1 is centered, largest, brightest — a slow radiant
 * breathing glow, a shimmering/floating crown, and the tallest/richest
 * stand; #2/#3 flank in true silver/bronze. A stronger radial stage
 * glow sits behind the whole group, itself breathing slowly, so the
 * three read as standing in light against the black.
 *
 * Entrance is a staggered reveal on first mount, not a simultaneous
 * pop: flanks settle, gold lands last with a one-shot bloom flourish
 * that hands off seamlessly into #1's continuous glow. Plays once per
 * session (CommunityPage keeps this mounted across tab switches via
 * the `hidden` className, so it never truly unmounts/remounts on a
 * normal tab change) — a reveal, not a replay loop. Every animation
 * here only touches transform/opacity/filter/box-shadow, so it stays
 * compositor-friendly and smooth rather than triggering layout.
 */
export function CommunityPodium({ rows, loading, meProfileId }: CommunityPodiumProps) {
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)', fontFamily: FONT, fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  const [first, second, third] = rows;

  if (!first) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontFamily: FONT, fontSize: 13 }}>
        Not enough climbers yet — be the first.
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', zIndex: 0 }}>
      {/* Stage glow — behind the whole group, not per-avatar. Its own
       *  slow independent breathe (6s, distinct cadence from #1's
       *  3.8s pulse) so the whole scene feels layered-alive rather
       *  than mechanically uniform. */}
      <div
        className="community-stage-glow"
        style={{
          position: 'absolute', top: '48%', left: '50%', width: 380, height: 230,
          transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: -1,
          background: 'radial-gradient(ellipse, rgba(255,210,74,0.22) 0%, rgba(255,130,0,0.07) 45%, transparent 75%)',
        }}
      />

      <div
        style={{
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          gap: 10, padding: '14px 0 4px',
        }}
      >
        {second && <PodiumSlot row={second} place={2} isMe={second.profileId === meProfileId} />}
        <PodiumSlot row={first} place={1} isMe={first.profileId === meProfileId} />
        {third && <PodiumSlot row={third} place={3} isMe={third.profileId === meProfileId} />}
      </div>

      <style>{`
        @keyframes communityPodiumRise {
          from { opacity: 0; transform: translateY(24px) scale(0.94); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .community-podium-slot {
          animation: communityPodiumRise ${ENTRANCE_MS}ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        @keyframes communityPodiumBloom {
          0% { opacity: 0; transform: scale(0.7); box-shadow: 0 0 0 rgba(255,210,74,0); }
          38% { opacity: 1; transform: scale(1.42); box-shadow: 0 0 46px 10px rgba(255,210,74,0.55); }
          100% { opacity: 0.85; transform: scale(1); box-shadow: 0 0 26px 4px rgba(255,210,74,0.32); }
        }
        .community-podium-bloom {
          opacity: 0;
          animation: communityPodiumBloom ${BLOOM_MS}ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes communityPodiumGlowPulse {
          0%, 100% { opacity: 0.85; transform: scale(1); box-shadow: 0 0 26px 4px rgba(255,210,74,0.32); }
          50% { opacity: 1; transform: scale(1.18); box-shadow: 0 0 44px 10px rgba(255,210,74,0.55); }
        }
        .community-podium-glow-pulse {
          opacity: 0;
          animation: communityPodiumGlowPulse 3800ms ease-in-out infinite;
        }

        @keyframes communityPodiumCrownShimmer {
          0%, 100% { filter: drop-shadow(0 0 5px rgba(255,210,74,0.5)); transform: translateY(0); }
          50% { filter: drop-shadow(0 0 13px rgba(255,210,74,0.95)); transform: translateY(-2px); }
        }
        .community-podium-crown {
          animation: communityPodiumCrownShimmer 3800ms ease-in-out infinite;
        }

        @keyframes communityStageGlowBreathe {
          0%, 100% { opacity: 0.85; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 1; transform: translate(-50%, -50%) scale(1.06); }
        }
        .community-stage-glow {
          animation: communityStageGlowBreathe 6000ms ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
