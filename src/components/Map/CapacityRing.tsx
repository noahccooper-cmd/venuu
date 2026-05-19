import { useEffect, useState } from 'react';

interface CapacityRingProps {
  capacityPct: number | null;       // 0.0 to 1.0+ (can exceed 1.0 when over fire code)
  color: string;                    // state primary
  glow: string;                     // state glow rgba (used for over-capacity bloom)
  size?: number;                    // outer diameter in px (default 64)
  stroke?: number;                  // ring stroke width in px (default 3)
  threshold?: number;               // min capacity_pct to render (default 0.30)
}

const TWO_PI = 2 * Math.PI;

/**
 * Circular SVG arc rendered around a market-mode bubble.
 *
 * Threshold-gated: returns null when capacity_pct < threshold so
 * Quiet venues stay clean dots and Busy+ venues earn the ring.
 * Arc fills clockwise from the top via a -90° rotate.
 * Animates from 0 to target over 600ms cubic-ease on mount + on
 * underlying capacity changes.
 * Display caps at 100% even when actual capacity exceeds it; the
 * over-capacity state gets a drop-shadow glow instead of a >360° arc.
 */
export function CapacityRing({
  capacityPct,
  color,
  glow,
  size = 64,
  stroke = 3,
  threshold = 0.30,
}: CapacityRingProps) {
  const [animatedPct, setAnimatedPct] = useState(0);

  const targetPct = Math.min(1, Math.max(0, capacityPct ?? 0));

  useEffect(() => {
    if (capacityPct == null || capacityPct < threshold) {
      setAnimatedPct(0);
      return;
    }
    const duration = 600;
    const start = performance.now();
    // Capture the current animatedPct from state once at effect-start
    // (avoids re-running the tween when the state updates mid-animation
    // — the listed exhaustive-deps lint allowance below preserves that).
    let raf = 0;
    const initial = animatedPct;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimatedPct(initial + (targetPct - initial) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetPct, threshold, capacityPct]);

  if (capacityPct == null || capacityPct < threshold) {
    return null;
  }

  const radius = (size - stroke) / 2;
  const center = size / 2;
  const circumference = TWO_PI * radius;
  const dashOffset = circumference * (1 - animatedPct);

  const isOverCapacity = capacityPct >= 1.0;

  return (
    <svg
      className="capacity-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%) rotate(-90deg)',
        pointerEvents: 'none',
        filter: isOverCapacity ? `drop-shadow(0 0 6px ${glow})` : 'none',
      }}
    >
      {/* track — faint background ring at full circumference */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={color}
        strokeOpacity={0.18}
        strokeWidth={stroke}
      />
      {/* fill — active arc, dashOffset animates from full → 0 */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
      />
    </svg>
  );
}
