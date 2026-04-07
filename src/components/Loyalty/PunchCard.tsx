import { useState, useCallback, useEffect } from 'react';
import { useLoyalty } from '../../hooks/useLoyalty';
import { useNFC, type NFCCheckInResult } from '../../hooks/useNFC';
import { supabase } from '../../lib/supabase';
import { getTonightDate } from '../../lib/nightlyCode';
import { Confetti } from '../Effects/Confetti';
import { CheckInCelebration } from '../UI/CheckInCelebration';

interface PunchCardProps {
  venueId: string;
  venueName: string;
  venueLat: number;
  venueLng: number;
  loyaltyActive: boolean;
  nfcRequired: boolean;
  userId: string | null;
  onSignIn: () => void;
}

const FONT = 'Satoshi, sans-serif';

/* ── Shared LOYALTY label ── */
function LoyaltyLabel() {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 600,
      color: 'rgba(255,255,255,0.4)',
      letterSpacing: '1px',
      textTransform: 'uppercase' as const,
      marginBottom: 10,
      fontFamily: FONT,
    }}>
      LOYALTY
    </div>
  );
}

/* ── Inline keyframes (injected once) ── */
const STYLE_ID = 'loyalty-keyframes';
function ensureKeyframes() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes loyalty-pulse-border {
      0%, 100% { border-color: rgba(255,130,0,0.3); box-shadow: 0 0 12px rgba(255,130,0,0.1); }
      50% { border-color: rgba(255,130,0,0.9); box-shadow: 0 0 24px rgba(255,130,0,0.3); }
    }
    @keyframes loyalty-pop-in {
      0% { transform: scale(0); opacity: 0; }
      60% { transform: scale(1.2); opacity: 1; }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes geo-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
      50% { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
    }
    @keyframes geo-dot-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    @keyframes dot-fill {
      0% { transform: scale(0); background: rgba(255,255,255,0.08); }
      50% { transform: scale(1.4); background: #FF8200; }
      75% { transform: scale(0.95); }
      100% { transform: scale(1); background: #FF8200; }
    }
    @keyframes dot-ring {
      0% { box-shadow: 0 0 0 0 rgba(255,130,0,0.6); }
      100% { box-shadow: 0 0 0 14px rgba(255,130,0,0); }
    }
    @keyframes dot-shimmer {
      0%, 100% { filter: brightness(1); }
      50% { filter: brightness(1.5); }
    }
    @keyframes dot-flash-all {
      0%, 100% { filter: brightness(1); box-shadow: 0 0 0 0 rgba(255,130,0,0); }
      50% { filter: brightness(1.8); box-shadow: 0 0 12px rgba(255,130,0,0.6); }
    }
    @keyframes success-scale {
      0% { transform: scale(0.7); opacity: 0; }
      60% { transform: scale(1.05); opacity: 1; }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes progress-fill {
      0% { width: 0%; }
    }
  `;
  document.head.appendChild(style);
}

export function PunchCard({ venueId, venueName, venueLat, venueLng, loyaltyActive, nfcRequired, userId, onSignIn }: PunchCardProps) {
  const {
    effectiveVisits, visitsRequired, rewardText, rewardDescription,
    hasCheckedInTonight, canRedeem, loading, redeem,
    checkInWithGPS, recordExternalCheckIn,
  } = useLoyalty(venueId, userId);

  const { startNFCScan, stopNFCScan } = useNFC(userId);

  const [mode, setMode] = useState<'progress' | 'scanning' | 'checkin-success' | 'reward' | 'pass' | 'redeem-success'>('progress');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [liveTime, setLiveTime] = useState('');
  const [showConfetti, setShowConfetti] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [justCheckedIn, setJustCheckedIn] = useState(false);
  const [allDotsFlash, setAllDotsFlash] = useState(false);
  const [tonightCheckins, setTonightCheckins] = useState<number | null>(null);
  const [nfcMessage, setNfcMessage] = useState('');

  // Inject keyframes
  useEffect(() => { ensureKeyframes(); }, []);

  // Reset mode when venue changes
  useEffect(() => {
    setMode('progress');
    setNfcMessage('');
    setShowConfetti(false);
    setShowCelebration(false);
    setJustCheckedIn(false);
    setAllDotsFlash(false);
  }, [venueId]);

  // Fetch tonight's check-in count for social proof
  useEffect(() => {
    if (!venueId) return;
    const nightOf = getTonightDate();
    const fetch = async () => {
      const { count } = await supabase
        .from('loyalty_visits')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId)
        .eq('night_of', nightOf);
      setTonightCheckins(count ?? 0);
    };
    fetch();
  }, [venueId, hasCheckedInTonight]);

  // Auto-switch to reward mode when canRedeem becomes true
  useEffect(() => {
    if (canRedeem && mode === 'progress') {
      setMode('reward');
    }
  }, [canRedeem, mode]);

  // Live timestamp for pass mode
  useEffect(() => {
    if (mode !== 'pass') return;
    const tick = () => setLiveTime(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [mode]);

  const onCheckInSuccess = useCallback((rewardEarned: boolean) => {
    setShowConfetti(true);
    setShowCelebration(true);
    setJustCheckedIn(true);
    setMode('checkin-success');
    // Haptic: medium for check-in, heavy for reward
    if (navigator.vibrate) {
      navigator.vibrate(rewardEarned ? [100, 50, 100, 50, 200] : [50, 50, 50]);
    }
    setTonightCheckins(prev => (prev ?? 0) + 1);

    setTimeout(() => {
      setAllDotsFlash(true);
      setTimeout(() => setAllDotsFlash(false), 600);
    }, 400);

    setTimeout(() => {
      setShowConfetti(false);
      setMode('progress');
      setTimeout(() => setJustCheckedIn(false), 600);
    }, 3000);
  }, []);

  /* ── NFC tap check-in ── */
  const handleNFCCheckIn = useCallback(() => {
    if (!userId) { onSignIn(); return; }
    setNfcMessage('');
    setMode('scanning');

    startNFCScan((result: NFCCheckInResult) => {
      if (result.success) {
        if (navigator.vibrate) navigator.vibrate(30);
        recordExternalCheckIn(); // sync useLoyalty state
        onCheckInSuccess(result.rewardEarned ?? false);
      } else {
        if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
        setNfcMessage(result.message);
        setMode('progress');
        setTimeout(() => setNfcMessage(''), 3000);
      }
    });
  }, [userId, onSignIn, startNFCScan, onCheckInSuccess, recordExternalCheckIn]);

  const handleCancelScan = useCallback(() => {
    stopNFCScan();
    setMode('progress');
  }, [stopNFCScan]);

  /* ── GPS proximity check-in (fallback for launch) ── */
  const handleGPSCheckIn = useCallback(async () => {
    if (!userId) { onSignIn(); return; }
    setNfcMessage('');
    setGpsLoading(true);

    const result = await checkInWithGPS(venueLat, venueLng);
    setGpsLoading(false);

    if (result.success) {
      if (navigator.vibrate) navigator.vibrate(30);
      onCheckInSuccess(false);
    } else {
      setNfcMessage(result.error ?? 'Check-in failed');
      setTimeout(() => setNfcMessage(''), 3000);
    }
  }, [userId, onSignIn, checkInWithGPS, venueLat, venueLng, onCheckInSuccess]);

  const handleRedeem = useCallback(async () => {
    const result = await redeem();
    if (result.success) {
      setMode('redeem-success');
      if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
      setTimeout(() => setMode('progress'), 2500);
    }
  }, [redeem]);

  if (loading) return null;

  // Not signed in — show sign-in prompt
  if (!userId) {
    return (
      <div style={{ padding: '16px 0' }}>
        <LoyaltyLabel />
        <div style={{
          background: '#111114', border: '1px solid #2A2A30', borderRadius: 14,
          padding: '20px 18px', textAlign: 'center' as const,
        }}>
          <p style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, color: '#8A8A95', margin: '0 0 12px' }}>
            Sign in to track your loyalty
          </p>
          <button
            onClick={onSignIn}
            className="active:scale-[0.97] transition-transform"
            style={{
              width: '100%', height: 44, borderRadius: 12,
              background: '#FF8200', border: 'none', color: 'white',
              fontFamily: FONT, fontSize: 14, fontWeight: 700,
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
            }}
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  // Punch dots — show effectiveVisits progress with animations
  const displayVisits = mode === 'redeem-success' ? 0 : effectiveVisits;
  const useProgressBar = visitsRequired > 10;

  const dots: React.ReactNode[] = [];
  if (!useProgressBar) {
    for (let i = 0; i < visitsRequired; i++) {
      const filled = i < displayVisits;
      const isNewlyFilled = justCheckedIn && i === displayVisits - 1;
      const shouldShimmer = justCheckedIn && filled && !isNewlyFilled;
      const staggerDelay = isNewlyFilled ? `${i * 60}ms` : '0ms';

      let dotAnimation = 'none';
      if (allDotsFlash && filled) {
        dotAnimation = `dot-flash-all 0.5s ease-in-out ${i * 60}ms`;
      } else if (isNewlyFilled) {
        dotAnimation = `dot-fill 350ms ease-out ${staggerDelay}, dot-ring 600ms ease-out ${staggerDelay}`;
      } else if (shouldShimmer) {
        dotAnimation = 'dot-shimmer 0.6s ease-in-out';
      }

      dots.push(
        <div
          key={i}
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: filled ? '#FF8200' : 'rgba(255,255,255,0.08)',
            border: filled ? '2px solid #FF8200' : '2px solid rgba(255,255,255,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            color: 'white',
            transition: isNewlyFilled ? 'none' : 'all 0.3s ease',
            animation: dotAnimation,
          }}
        >
          {filled ? '\u2713' : ''}
        </div>
      );
    }
  }

  const remaining = visitsRequired - displayVisits;
  const progressPct = visitsRequired > 0 ? Math.round((displayVisits / visitsRequired) * 100) : 0;

  // For >10 visits, render a labeled progress bar instead of individual dots
  const ProgressBar = ({ animate = false }: { animate?: boolean }) => (
    <div style={{ width: '100%' }}>
      <div style={{
        width: '100%', height: 10, borderRadius: 5,
        background: 'rgba(255,255,255,0.08)', overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', borderRadius: 5,
          background: 'linear-gradient(90deg, #FF8200, #F1B82D)',
          width: `${progressPct}%`,
          transition: 'width 0.6s ease',
          animation: animate ? 'progress-fill 0.8s ease-out' : 'none',
        }} />
      </div>
      <p style={{ fontFamily: FONT, fontSize: 12, color: '#8A8A95', textAlign: 'center' as const, marginTop: 6 }}>
        {displayVisits} / {visitsRequired} visits
      </p>
    </div>
  );

  const DotsOrBar = ({ animate = false }: { animate?: boolean }) => useProgressBar
    ? <ProgressBar animate={animate} />
    : <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' as const }}>{dots}</div>;

  // ── Not signed in ──
  if (!userId) {
    return (
      <div style={{ padding: '16px 0' }}>
        <LoyaltyLabel />
        <div style={{
          background: '#111114',
          border: '1px solid #2A2A30',
          borderRadius: 14,
          padding: '16px 18px',
          textAlign: 'center' as const,
        }}>
          <p style={{ fontFamily: FONT, fontSize: 14, color: '#8A8A95', marginBottom: 12 }}>
            Sign in to start earning rewards
          </p>
          <button
            onClick={onSignIn}
            style={{
              fontFamily: FONT, fontSize: 14, fontWeight: 700,
              color: '#FF8200', background: 'transparent',
              border: '1px solid #FF8200', borderRadius: 10,
              padding: '8px 24px', cursor: 'pointer',
            }}
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  // ── Redeem success ──
  if (mode === 'redeem-success') {
    return (
      <div style={{ padding: '16px 0' }}>
        <LoyaltyLabel />
        <div style={{
          background: '#111114',
          border: '1px solid #22C55E',
          borderRadius: 14,
          padding: '24px 18px',
          textAlign: 'center' as const,
        }}>
          <div style={{ fontSize: 48, marginBottom: 8, animation: 'loyalty-pop-in 0.4s ease-out' }}>{'\u2705'}</div>
          <p style={{ fontFamily: FONT, fontSize: 18, fontWeight: 700, color: '#22C55E', marginBottom: 8 }}>
            Enjoy!
          </p>
          <p style={{ fontFamily: FONT, fontSize: 13, color: '#8A8A95' }}>
            Start earning your next reward
          </p>
          <div style={{ marginTop: 12 }}>
            <DotsOrBar />
          </div>
        </div>
      </div>
    );
  }

  // ── Live redemption pass ──
  if (mode === 'pass') {
    const rewardDisplay = rewardText?.toUpperCase() || 'FREE REWARD';
    return (
      <div style={{ padding: '16px 0' }}>
        <LoyaltyLabel />
        <div style={{
          background: '#111114',
          border: '2px solid rgba(255,130,0,0.5)',
          borderRadius: 14,
          padding: '28px 18px',
          textAlign: 'center' as const,
          animation: 'loyalty-pulse-border 2s infinite ease-in-out',
        }}>
          <p style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: '#8A8A95', marginBottom: 12 }}>
            {venueName}
          </p>
          <p style={{
            fontFamily: FONT, fontSize: 32, fontWeight: 800,
            color: '#FF8200', letterSpacing: '2px',
            lineHeight: 1, marginBottom: 12,
          }}>
            {rewardDisplay}
          </p>
          <p style={{ fontFamily: FONT, fontSize: 13, color: '#55555F', marginBottom: 16 }}>
            Show this to your bartender
          </p>
          <p style={{
            fontFamily: 'monospace', fontSize: 14,
            color: '#55555F', marginBottom: 20,
          }}>
            {liveTime}
          </p>
          <button
            onClick={handleRedeem}
            style={{
              display: 'block', width: '100%', height: 44,
              borderRadius: 12, background: '#1A1A24',
              border: '1px solid #2A2A30', color: 'white',
              fontFamily: FONT, fontSize: 14, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            I got my reward
          </button>
        </div>
      </div>
    );
  }

  // ── Reward earned ──
  if (mode === 'reward' && canRedeem) {
    return (
      <div style={{ padding: '16px 0' }}>
        <LoyaltyLabel />
        <div style={{
          background: '#111114',
          border: '1px solid #FF8200',
          borderRadius: 14,
          padding: '20px 18px',
          textAlign: 'center' as const,
        }}>
          <div style={{ marginBottom: 12 }}>
            <DotsOrBar />
          </div>
          <p style={{ fontFamily: FONT, fontSize: 18, fontWeight: 700, color: 'white', marginBottom: 6 }}>
            You earned a reward!
          </p>
          {rewardText && (
            <p style={{ fontFamily: FONT, fontSize: 14, color: '#FF8200', marginBottom: rewardDescription ? 4 : 16 }}>
              {rewardText}
            </p>
          )}
          {rewardDescription && (
            <p style={{ fontFamily: FONT, fontSize: 12, color: '#8A8A95', marginBottom: 16 }}>
              {rewardDescription}
            </p>
          )}
          <button
            onClick={() => setMode('pass')}
            style={{
              display: 'block', width: '100%', height: 48,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #FF5E1A, #FF2D05)',
              border: 'none', color: 'white',
              fontFamily: FONT, fontSize: 16, fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Redeem
          </button>
        </div>
      </div>
    );
  }

  // ── Check-in success (redesigned) ──
  if (mode === 'checkin-success') {
    return (
      <div style={{ padding: '16px 0', position: 'relative' }}>
        {showConfetti && <Confetti onDone={() => setShowConfetti(false)} />}
        {showCelebration && (
          <CheckInCelebration
            venueName={venueName}
            visits={displayVisits}
            visitsRequired={visitsRequired}
            onDone={() => setShowCelebration(false)}
          />
        )}
        <LoyaltyLabel />
        <div style={{
          background: '#111114',
          border: '1px solid #22C55E',
          borderRadius: 14,
          padding: '28px 18px',
          textAlign: 'center' as const,
          position: 'relative',
          overflow: 'hidden',
        }}>
          <p style={{
            fontFamily: FONT, fontSize: 24, fontWeight: 800, color: 'white',
            marginBottom: 6,
            animation: 'success-scale 0.5s ease-out',
          }}>
            CHECKED IN!
          </p>
          <p style={{ fontFamily: FONT, fontSize: 13, color: '#8A8A95', marginBottom: 4 }}>
            You're one step closer to{rewardText ? '' : ' a free drink'}
          </p>
          <p style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, color: '#FF8200', marginBottom: 16 }}>
            {rewardText || venueName}
          </p>

          {/* Animated progress bar */}
          <div style={{
            width: '100%',
            height: 8,
            borderRadius: 4,
            background: 'rgba(255,255,255,0.08)',
            marginBottom: 8,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              borderRadius: 4,
              background: 'linear-gradient(90deg, #FF8200, #F1B82D)',
              width: `${progressPct}%`,
              animation: 'progress-fill 0.8s ease-out',
            }} />
          </div>

          <p style={{ fontFamily: FONT, fontSize: 12, color: '#8A8A95' }}>
            {displayVisits} of {visitsRequired} — {remaining > 0 ? `${remaining} more to go` : 'Reward unlocked!'}
          </p>

          <div style={{ marginTop: 12 }}>
            <DotsOrBar animate />
          </div>
        </div>
      </div>
    );
  }

  // ── NFC Scanning overlay ──
  if (mode === 'scanning') {
    return (
      <div style={{ padding: '16px 0' }}>
        <LoyaltyLabel />
        <div style={{
          background: '#111114',
          border: '1px solid rgba(255, 130, 0, 0.3)',
          borderRadius: 14,
          padding: '28px 18px',
          textAlign: 'center' as const,
        }}>
          {/* NFC icon with radiating waves */}
          <div style={{
            position: 'relative',
            width: 100, height: 100,
            margin: '0 auto 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {/* Outer wave */}
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              border: '2px solid rgba(255, 130, 0, 0.15)',
              animation: 'nfc-wave 2s ease-out infinite',
            }} />
            {/* Middle wave */}
            <div style={{
              position: 'absolute', inset: 10, borderRadius: '50%',
              border: '2px solid rgba(255, 130, 0, 0.25)',
              animation: 'nfc-wave 2s ease-out infinite 0.4s',
            }} />
            {/* Inner glow circle */}
            <div style={{
              width: 60, height: 60, borderRadius: '50%',
              background: 'rgba(255, 130, 0, 0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'nfc-breathe 1.5s ease-in-out infinite',
            }}>
              <span style={{ fontSize: 28 }}>{'\uD83D\uDCF3'}</span>
            </div>
          </div>
          <p style={{ fontFamily: FONT, fontSize: 17, fontWeight: 700, color: 'white', marginBottom: 6 }}>
            Hold your phone near the venuu card
          </p>
          <p style={{ fontFamily: FONT, fontSize: 13, color: '#8A8A95', marginBottom: 4 }}>
            Look for the NFC card at the bar
          </p>
          <p style={{ fontFamily: FONT, fontSize: 12, color: '#FF8200', marginBottom: 16 }}>
            Scanning...
          </p>
          <button
            onClick={handleCancelScan}
            className="active:scale-[0.97] transition-transform"
            style={{
              fontFamily: FONT, fontSize: 14, fontWeight: 600, color: '#8A8A95',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10, padding: '10px 24px', cursor: 'pointer',
              minHeight: 44, WebkitTapHighlightColor: 'transparent',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Progress (default) — dots + check-in ──
  return (
    <div style={{ padding: '16px 0' }}>
      <LoyaltyLabel />

      {/* Live check-in count — social proof */}
      {tonightCheckins !== null && tonightCheckins > 0 && (
        <p style={{
          fontFamily: FONT, fontSize: 12, fontWeight: 700,
          color: '#FF8200', marginBottom: 8,
        }}>
          {'\uD83D\uDD25'} {tonightCheckins} check-in{tonightCheckins !== 1 ? 's' : ''} tonight
        </p>
      )}

      <div style={{
        background: '#111114',
        border: loyaltyActive ? '1px solid rgba(255, 130, 0, 0.2)' : '1px solid #2A2A30',
        borderRadius: 14,
        padding: '16px 18px',
      }}>
        {/* Loyalty active indicator */}
        {loyaltyActive && !hasCheckedInTonight && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 12,
            justifyContent: 'center',
          }}>
            <span style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#FF8200',
              animation: 'geo-dot-pulse 1.5s ease-in-out infinite',
            }} />
            <span style={{
              fontFamily: FONT,
              fontSize: 13,
              fontWeight: 700,
              color: '#FF8200',
            }}>
              Tap to check in at {venueName}
            </span>
          </div>
        )}

        {useProgressBar ? (
          <div style={{ marginBottom: 8 }}>
            <DotsOrBar />
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' as const, marginBottom: 8 }}>
              {dots}
            </div>
            <p style={{ fontFamily: FONT, fontSize: 13, color: '#8A8A95', textAlign: 'center' as const, marginBottom: 4 }}>
              {effectiveVisits} of {visitsRequired} visits
            </p>
          </>
        )}

        {/* Reward banner */}
        {rewardText ? (
          <div style={{
            background: 'rgba(255, 130, 0, 0.08)',
            border: '1px solid rgba(255, 130, 0, 0.15)',
            borderRadius: 8,
            padding: '6px 10px',
            textAlign: 'center' as const,
            marginBottom: 10,
          }}>
            <p style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: '#FF8200', margin: 0 }}>
              {remaining > 0 ? `${remaining} more for: ${rewardText}` : `Earn: ${rewardText}`}
            </p>
            {rewardDescription && (
              <p style={{ fontFamily: FONT, fontSize: 11, color: 'rgba(255,255,255,0.45)', margin: '3px 0 0' }}>
                {rewardDescription}
              </p>
            )}
          </div>
        ) : (
          <p style={{ fontFamily: FONT, fontSize: 11, color: '#55555F', textAlign: 'center' as const, marginBottom: 10, fontStyle: 'italic' }}>
            Check back soon — rewards coming
          </p>
        )}

        {/* Check-in state */}
        {hasCheckedInTonight ? (
          <div style={{ textAlign: 'center' as const, padding: '8px 0' }}>
            <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: '#22C55E' }}>
              {'\u2713'} Checked in tonight
            </span>
          </div>
        ) : loyaltyActive ? (
          /* ── Check-in: NFC or GPS depending on venue config ── */
          <div>
            {nfcRequired ? (
              /* NFC required — show NFC button */
              <button
                onClick={handleNFCCheckIn}
                className="active:scale-[0.97] transition-transform"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  width: '100%', height: 50, borderRadius: 14,
                  background: 'linear-gradient(135deg, #FF5E1A, #FF2D05)',
                  border: 'none', color: 'white', fontFamily: FONT, fontSize: 16, fontWeight: 700,
                  cursor: 'pointer', marginTop: 4, WebkitTapHighlightColor: 'transparent',
                }}
              >
                {'\uD83D\uDCF3'} TAP TO CHECK IN
              </button>
            ) : (
              /* GPS proximity — show location-based button */
              <button
                onClick={handleGPSCheckIn}
                disabled={gpsLoading}
                className="active:scale-[0.97] transition-transform"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  width: '100%', height: 50, borderRadius: 14,
                  background: gpsLoading ? 'rgba(255, 130, 0, 0.4)' : 'linear-gradient(135deg, #FF5E1A, #FF2D05)',
                  border: 'none', color: 'white', fontFamily: FONT, fontSize: 16, fontWeight: 700,
                  cursor: gpsLoading ? 'wait' : 'pointer', marginTop: 4, WebkitTapHighlightColor: 'transparent',
                  opacity: gpsLoading ? 0.7 : 1,
                }}
              >
                {gpsLoading ? 'Checking in...' : '\uD83D\uDCCD CHECK IN'}
              </button>
            )}
            <p style={{
              fontFamily: FONT, fontSize: 11, color: 'rgba(255,255,255,0.25)',
              textAlign: 'center' as const, marginTop: 8,
            }}>
              {nfcRequired ? 'Hold your phone near the venuu card at the bar' : 'You need to be at the bar to check in'}
            </p>
            {nfcMessage && (
              <p style={{
                fontFamily: FONT, fontSize: 12, fontWeight: 600,
                color: nfcMessage.includes('Already') || nfcMessage.includes('closer') ? '#FF8200' : '#EF4444',
                textAlign: 'center' as const, marginTop: 6,
              }}>
                {nfcMessage}
              </p>
            )}
          </div>
        ) : (
          /* Loyalty not active at this venue */
          <div style={{ textAlign: 'center' as const, padding: '8px 0' }}>
            <p style={{ fontFamily: FONT, fontSize: 12, color: '#55555F' }}>
              Check-in not available right now
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
