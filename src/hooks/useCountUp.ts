import { useEffect, useRef, useState } from 'react';

/**
 * useCountUp — animates an integer from 0 to `target` over `duration`
 * milliseconds on mount, and on any subsequent target change.
 *
 * Used by the profile hero stats so big numbers feel earned rather
 * than dumped. RAF-driven; eases via `1 - (1 - t)^3` (cubic-out).
 */
export function useCountUp(target: number, duration = 800): number {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);
  const fromRef = useRef(0);
  const startedAtRef = useRef(0);

  useEffect(() => {
    // Cancel any in-flight animation.
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Anchor the animation at the current display value so a target
    // change mid-flight transitions smoothly instead of snapping to 0.
    fromRef.current = display;
    startedAtRef.current = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startedAtRef.current;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(fromRef.current + (target - fromRef.current) * eased);
      setDisplay(value);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // We intentionally re-run when `target` changes, not when `display`
    // changes — display is the *output* and would create a tight loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return display;
}
