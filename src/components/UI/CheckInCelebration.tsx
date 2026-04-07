import { useEffect, useState } from 'react';

/* ── Full-screen check-in celebration ── */

const COLORS = ['#FF8200', '#FFB347', '#FFFFFF', '#FFD700'];
const PARTICLE_COUNT = 40;
const FONT = 'Satoshi, sans-serif';

const STYLE_ID = 'checkin-celebration-kf';
function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes celeb-particle-appear {
      0% { transform: translate(-50%, -50%) scale(0); opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
    }
    @keyframes celeb-particle-burst {
      0% { transform: translate(var(--px), var(--py)) rotate(0deg); opacity: 1; }
      100% { transform: translate(var(--ex), var(--ey)) rotate(var(--rot)); opacity: 0; }
    }
    @keyframes celeb-check-spring {
      0% { transform: scale(0); opacity: 0; }
      50% { transform: scale(1.2); opacity: 1; }
      70% { transform: scale(0.95); }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes celeb-text-in {
      0% { transform: translateY(8px); opacity: 0; }
      100% { transform: translateY(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

interface CheckInCelebrationProps {
  venueName: string;
  visits: number;
  visitsRequired: number;
  onDone: () => void;
}

export function CheckInCelebration({ venueName, visits, visitsRequired, onDone }: CheckInCelebrationProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    ensureStyles();
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDone, 300);
    }, 2200);
    return () => clearTimeout(timer);
  }, [onDone]);

  if (!visible) return null;

  const particles = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
    const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + (Math.random() - 0.5) * 0.6;
    const dist = 100 + Math.random() * 180; // 100-280px
    const startX = 0;
    const startY = 0;
    const endX = Math.cos(angle) * dist;
    const endY = Math.sin(angle) * dist;
    const rotation = Math.floor(Math.random() * 720);
    const size = 6;
    const color = COLORS[i % COLORS.length];
    const isCircle = Math.random() > 0.5;

    return (
      <div
        key={i}
        style={{
          position: 'absolute',
          left: '50%',
          top: '45%',
          width: size,
          height: size,
          borderRadius: isCircle ? '50%' : '1px',
          background: color,
          '--px': `${startX}px`,
          '--py': `${startY}px`,
          '--ex': `${endX}px`,
          '--ey': `${endY}px`,
          '--rot': `${rotation}deg`,
          animation: `celeb-particle-appear 100ms ease-out forwards, celeb-particle-burst 700ms 100ms ease-out forwards`,
        } as React.CSSProperties}
      />
    );
  });

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 500,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
      transition: 'opacity 0.3s ease',
      opacity: visible ? 1 : 0,
    }}>
      {/* Dark scrim */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
      }} />

      {/* Particles */}
      {particles}

      {/* Checkmark circle */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>
        <div style={{
          width: 60,
          height: 60,
          borderRadius: '50%',
          background: '#FF8200',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'celeb-check-spring 400ms cubic-bezier(0.32, 0.72, 0, 1) forwards',
          boxShadow: '0 0 30px rgba(255,130,0,0.5)',
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        {/* Text */}
        <p style={{
          fontFamily: FONT,
          fontSize: 22,
          fontWeight: 800,
          color: 'white',
          marginTop: 16,
          animation: 'celeb-text-in 400ms 200ms ease-out both',
        }}>
          Checked in!
        </p>

        <p style={{
          fontFamily: FONT,
          fontSize: 14,
          fontWeight: 600,
          color: 'rgba(255,255,255,0.7)',
          marginTop: 8,
          animation: 'celeb-text-in 400ms 350ms ease-out both',
        }}>
          {visits}/{visitsRequired} at {venueName} {'\uD83C\uDF7A'}
        </p>
      </div>
    </div>
  );
}
