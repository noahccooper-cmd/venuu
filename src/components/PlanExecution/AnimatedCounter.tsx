import { memo, useEffect, useRef, useState } from 'react';

/**
 * AnimatedCounter — ticks a number from `from` to `to` with an
 * ease-out-expo curve, then plays a brief "settled" pulse + glow
 * once the final value lands. Used by EndNightModal so each stat
 * arrives with a beat instead of a flat read.
 *
 * The pulse fires ~80ms AFTER the counter reaches the final value
 * so the user has a frame to register the number before the
 * scale-up + drop-shadow flare hits.
 */

interface AnimatedCounterProps {
  from: number;
  to: number;
  duration: number;
  prefix?: string;
  suffix?: string;
  formatter?: (n: number) => string;
}

function AnimatedCounterInner({
  from,
  to,
  duration,
  prefix = '',
  suffix = '',
  formatter,
}: AnimatedCounterProps) {
  const [val, setVal] = useState<number>(from);
  const [settled, setSettled] = useState(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (from === to) {
      setVal(to);
      setSettled(true);
      return;
    }
    setSettled(false);
    const startTs = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - startTs;
      const t = Math.min(1, elapsed / duration);
      // ease-out-expo
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const current = Math.round(from + (to - from) * eased);
      setVal(current);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        // Brief delay so the final value is visible BEFORE the
        // settle-pulse fires — otherwise the pulse and the
        // last frame collide and the moment reads as noise.
        settleTimerRef.current = setTimeout(() => setSettled(true), 80);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, [from, to, duration]);

  const rendered = formatter ? formatter(val) : String(val);
  return (
    <span className={`animated-counter${settled ? ' animated-counter--settled' : ''}`}>
      {prefix}{rendered}{suffix}
    </span>
  );
}

export const AnimatedCounter = memo(AnimatedCounterInner);
