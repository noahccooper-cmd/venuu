import { useCallback, useRef, useState } from 'react';
import { hapticSelection } from '../lib/haptics';

const PULL_PX = 90;         // drag distance for a full pull
const DECIDE_PX = 8;        // movement before we know it's vertical
const MIN_SPIN_MS = 700;    // keep the sun up long enough to read as feedback

/**
 * Pull down (on the element the handlers are spread onto) to refresh.
 * Horizontal drags are left alone (the rings row still scrolls sideways).
 * Returns progress 0…1 while pulling and `refreshing` until onRefresh settles.
 */
export function usePullToRefresh(onRefresh: () => Promise<void> | void) {
  const [progress, setProgress] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const mode = useRef<'idle' | 'pull' | 'pass'>('idle');
  const armed = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (refreshing) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    mode.current = 'idle';
    armed.current = false;
  }, [refreshing]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (mode.current === 'idle') {
      if (Math.hypot(dx, dy) < DECIDE_PX) return;
      mode.current = dy > Math.abs(dx) ? 'pull' : 'pass';
      if (mode.current === 'pull') (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    if (mode.current !== 'pull') return;
    // Resistance: the sun follows less as you pull further.
    const p = Math.max(0, Math.min(1.15, (dy / PULL_PX) * (1 - Math.min(0.35, dy / (PULL_PX * 6)))));
    setProgress(p);
    if (p >= 1 && !armed.current) { armed.current = true; hapticSelection(); }
    if (p < 1 && armed.current) armed.current = false;
  }, []);

  const end = useCallback(async () => {
    const wasPull = mode.current === 'pull';
    const fire = armed.current;
    start.current = null;
    mode.current = 'idle';
    armed.current = false;
    if (!wasPull) return;
    if (!fire) { setProgress(0); return; }
    setRefreshing(true);
    const t0 = performance.now();
    try { await onRefresh(); } finally {
      const wait = Math.max(0, MIN_SPIN_MS - (performance.now() - t0));
      window.setTimeout(() => { setRefreshing(false); setProgress(0); }, wait);
    }
  }, [onRefresh]);

  return {
    progress,
    refreshing,
    handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end },
  };
}
