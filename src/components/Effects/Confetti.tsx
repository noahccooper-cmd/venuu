import { useEffect, useRef } from 'react';

const COLORS = ['#FF8200', '#FFFFFF', '#F1B82D', '#22C55E'];
const PARTICLE_COUNT = 24;
const DURATION = 1500;

const STYLE_ID = 'confetti-keyframes';
function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes confetti-burst {
      0% {
        transform: translate(0, 0) rotate(0deg) scale(1);
        opacity: 1;
      }
      100% {
        transform: translate(var(--cx), var(--cy)) rotate(var(--cr)) scale(0);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}

export function Confetti({ onDone }: { onDone?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensureStyles();
    const timer = setTimeout(() => onDone?.(), DURATION);
    return () => clearTimeout(timer);
  }, [onDone]);

  const particles = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
    const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + (Math.random() - 0.5) * 0.5;
    const dist = 60 + Math.random() * 80;
    const cx = Math.cos(angle) * dist;
    const cy = Math.sin(angle) * dist - 40; // bias upward
    const rotation = Math.random() * 720 - 360;
    const size = 5 + Math.random() * 5;
    const color = COLORS[i % COLORS.length];
    const isCircle = Math.random() > 0.5;
    const delay = Math.random() * 100;

    return (
      <div
        key={i}
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: size,
          height: size,
          borderRadius: isCircle ? '50%' : '2px',
          background: color,
          '--cx': `${cx}px`,
          '--cy': `${cy}px`,
          '--cr': `${rotation}deg`,
          animation: `confetti-burst ${DURATION}ms cubic-bezier(0.25, 0.46, 0.45, 0.94) ${delay}ms forwards`,
        } as React.CSSProperties}
      />
    );
  });

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 10,
      }}
    >
      {particles}
    </div>
  );
}
