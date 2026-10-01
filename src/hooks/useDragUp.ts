import { useMemo, useRef } from 'react';

const TRIGGER_PX = 48;

/**
 * Drag a carousel UP to open the feed. Horizontal drags stay the
 * carousel's (a drag counts only when it's clearly vertical). Touch on
 * devices, mouse drags on web.
 */
export function useDragUp(onUp: (() => void) | null) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  return useMemo(() => {
    if (!onUp) return {};
    const begin = (x: number, y: number) => { start.current = { x, y }; fired.current = false; };
    const move = (x: number, y: number) => {
      const s = start.current;
      if (!s || fired.current) return;
      const dx = x - s.x;
      const dy = y - s.y;
      if (dy < -TRIGGER_PX && Math.abs(dy) > Math.abs(dx) * 1.5) { fired.current = true; onUp(); }
    };
    const end = () => { start.current = null; };
    return {
      onTouchStart: (e: React.TouchEvent) => begin(e.touches[0].clientX, e.touches[0].clientY),
      onTouchMove: (e: React.TouchEvent) => move(e.touches[0].clientX, e.touches[0].clientY),
      onTouchEnd: end,
      onMouseDown: (e: React.MouseEvent) => begin(e.clientX, e.clientY),
      onMouseMove: (e: React.MouseEvent) => { if (e.buttons) move(e.clientX, e.clientY); },
      onMouseUp: end,
    };
  }, [onUp]);
}
