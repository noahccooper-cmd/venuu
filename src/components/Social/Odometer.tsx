import { useEffect, useState } from 'react';

interface OdometerProps {
  value: number;
  /** Roll starts after this many ms (the arrival stagger). */
  delay?: number;
  /** When false the digits sit at 0, ready to roll. */
  run: boolean;
  reduced: boolean;
}

/**
 * Digits roll from 0 up to their value — one vertical strip per digit,
 * tabular so the width never jumps. Reduced motion: value, instantly.
 */
export function Odometer({ value, delay = 0, run, reduced }: OdometerProps) {
  const [shown, setShown] = useState(reduced ? value : 0);

  useEffect(() => {
    if (reduced) { setShown(value); return; }
    if (!run) { setShown(0); return; }
    const t = window.setTimeout(() => setShown(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay, run, reduced]);

  const digits = String(value).split('');
  const shownDigits = String(shown).padStart(digits.length, '0').split('');

  return (
    <span className="social-num" style={{ display: 'inline-flex', height: '1.2em', overflow: 'hidden', lineHeight: 1.2 }}>
      {digits.map((_, i) => {
        const d = Number(shownDigits[i]);
        return (
          <span key={i} style={{ display: 'inline-block', width: '1ch', position: 'relative' }}>
            <span
              style={{
                display: 'flex',
                flexDirection: 'column',
                transform: `translateY(${-d * 1.2}em)`,
                transition: reduced ? 'none' : 'transform 350ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              {Array.from({ length: 10 }, (_, n) => (
                <span key={n} style={{ height: '1.2em' }}>{n}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
