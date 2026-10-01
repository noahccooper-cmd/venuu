import { useEffect, useState } from 'react';

/**
 * Odometer-style number. When `value` changes, only the digit columns
 * that differ roll (up when rising, down when falling) over ~300ms;
 * unchanged digits — and unchanged values — never move. Digits are
 * tabular so the pill doesn't jitter mid-roll. With
 * prefers-reduced-motion the new value simply swaps in.
 */

const ROLL_MS = 300;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

interface Roll { from: number; to: number; id: number }

export function RollingNumber({ value }: { value: number }) {
  const reduced = usePrefersReducedMotion();
  const [prev, setPrev] = useState(value);
  const [roll, setRoll] = useState<Roll | null>(null);

  // Derive the roll during render (React's "adjust state on prop change"
  // pattern): the rolling markup is what gets committed, so the new value
  // never flashes statically first.
  if (value !== prev) {
    setPrev(value);
    setRoll(reduced ? null : { from: prev, to: value, id: (roll?.id ?? 0) + 1 });
  }

  useEffect(() => {
    if (!roll) return;
    const t = window.setTimeout(() => setRoll(null), ROLL_MS + 40);
    return () => clearTimeout(t);
  }, [roll]);

  const srOnly: React.CSSProperties = {
    position: 'absolute', width: 1, height: 1, overflow: 'hidden',
    clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
  };

  if (!roll) {
    return (
      <span className="lvb-num">
        {value}
      </span>
    );
  }

  const toStr = String(roll.to);
  const fromStr = String(roll.from);
  const len = Math.max(toStr.length, fromStr.length);
  const to = toStr.padStart(len, ' ');
  const from = fromStr.padStart(len, ' ');
  const up = roll.to > roll.from;

  return (
    <span className="lvb-num">
      <span style={srOnly}>{roll.to}</span>
      <span aria-hidden>
        {Array.from(to).map((ch, i) => {
          const prev = from[i];
          if (prev === ch) return <span key={i}>{ch === ' ' ? '' : ch}</span>;
          const top = up ? prev : ch;
          const bottom = up ? ch : prev;
          return (
            <span key={`${roll.id}-${i}`} className="lvb-digit">
              <span className={`lvb-digit-col ${up ? 'lvb-roll-up' : 'lvb-roll-down'}`}>
                <span>{top === ' ' ? ' ' : top}</span>
                <span>{bottom === ' ' ? ' ' : bottom}</span>
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}

export const ROLLING_NUMBER_CSS = `
.lvb-num {
  position: relative;
  display: inline-flex;
  font-variant-numeric: tabular-nums;
}
.lvb-digit {
  display: inline-block;
  height: 1em;
  overflow: hidden;
  vertical-align: top;
}
.lvb-digit-col {
  display: flex;
  flex-direction: column;
  line-height: 1em;
  will-change: transform;
}
.lvb-digit-col > span { height: 1em; }
@keyframes lvb-roll-up   { from { transform: translateY(0); }    to { transform: translateY(-50%); } }
@keyframes lvb-roll-down { from { transform: translateY(-50%); } to { transform: translateY(0); } }
.lvb-roll-up   { animation: lvb-roll-up ${ROLL_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards; }
.lvb-roll-down { animation: lvb-roll-down ${ROLL_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards; }
@media (prefers-reduced-motion: reduce) {
  .lvb-roll-up, .lvb-roll-down { animation: none; }
}
`;
