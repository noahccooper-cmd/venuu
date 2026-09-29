import { useEffect, useRef, useState } from 'react';
import { hapticTick } from '../../lib/haptics';
import { prefersReducedMotion } from '../../lib/socialGeo';

export type SheetSnap = 'peek' | 'half' | 'full';
export const PEEK_PX = 96;

export function snapHeight(snap: SheetSnap, containerH: number): number {
  if (snap === 'peek') return PEEK_PX;
  if (snap === 'half') return Math.round(containerH * 0.5);
  return Math.round(containerH * 0.92);
}

const ORDER: SheetSnap[] = ['peek', 'half', 'full'];
const DRAG_THRESHOLD = 6;     // px before a press becomes a drag (taps stay taps)
const FLICK = 0.5;            // px/ms — faster than this jumps a snap

interface SocialSheetProps {
  snap: SheetSnap;
  onSnap: (s: SheetSnap) => void;
  containerH: number;
  /** Always visible (peek shows only this). Drags from here at every snap. */
  header: React.ReactNode;
  children: React.ReactNode;
  /** Changing this scrolls the body back to the top (new content). */
  contentKey: string;
}

/**
 * Bottom sheet over the Social map: peek / half / full. Velocity-based
 * snapping; the body scrolls only at full (below that, dragging anywhere
 * moves the sheet).
 */
export function SocialSheet({ snap, onSnap, containerH, header, children, contentKey }: SocialSheetProps) {
  const reduced = prefersReducedMotion();
  const fullH = snapHeight('full', containerH);
  const snapH = snapHeight(snap, containerH);
  const [dragH, setDragH] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // v: smoothed velocity in px/ms (+ = finger moving up), from recent moves.
  const drag = useRef<{ y: number; h: number; lastY: number; lastT: number; v: number; active: boolean } | null>(null);

  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [contentKey]);

  const height = dragH ?? snapH;

  const onPointerDown = (e: React.PointerEvent, fromBody: boolean) => {
    // At full, the body scrolls instead of dragging the sheet.
    if (fromBody && snap === 'full') return;
    drag.current = { y: e.clientY, h: snapH, lastY: e.clientY, lastT: e.timeStamp, v: 0, active: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (!d.active) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return;
      d.active = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.v = 0.6 * ((d.lastY - e.clientY) / dt) + 0.4 * d.v;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    setDragH(Math.max(PEEK_PX * 0.8, Math.min(fullH, d.h - dy)));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.active) return;
    const h = Math.max(PEEK_PX, Math.min(fullH, d.h - (e.clientY - d.y)));
    // A pause before lifting cancels the flick.
    const v = e.timeStamp - d.lastT > 100 ? 0 : d.v;
    const heights = ORDER.map(s => snapHeight(s, containerH));
    let next: SheetSnap;
    if (Math.abs(v) > FLICK) {
      const cur = ORDER.indexOf(snap);
      next = ORDER[Math.max(0, Math.min(2, cur + (v > 0 ? 1 : -1)))];
      // A long, fast flick can pass a snap: pick by where it's headed.
      if (v > 0 && h > heights[1] + 40) next = 'full';
      if (v < 0 && h < heights[1] - 40) next = 'peek';
    } else {
      next = ORDER.reduce((best, s, i) => (Math.abs(heights[i] - h) < Math.abs(snapHeight(best, containerH) - h) ? s : best), snap);
    }
    setDragH(null);
    if (next !== snap) hapticTick();
    onSnap(next);
  };

  return (
    <div
      role="dialog"
      aria-label="Social sheet"
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: fullH, zIndex: 5,
        transform: `translateY(${fullH - height}px)`,
        transition: dragH !== null || reduced ? 'none' : 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)',
        background: 'var(--social-bg)',
        borderTop: '1px solid var(--social-hairline)',
        borderRadius: '16px 16px 0 0',
        boxShadow: '0 -8px 24px rgba(0, 0, 0, 0.35)',
        display: 'flex', flexDirection: 'column',
        touchAction: 'none',
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div onPointerDown={e => onPointerDown(e, false)} style={{ flexShrink: 0, cursor: 'grab' }}>
        <div style={{ display: 'grid', placeItems: 'center', height: 20 }}>
          <span aria-hidden style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.22)' }} />
        </div>
        {header}
      </div>
      <div
        ref={bodyRef}
        onPointerDown={e => onPointerDown(e, true)}
        style={{
          flex: 1, minHeight: 0,
          overflowY: snap === 'full' && dragH === null ? 'auto' : 'hidden',
          touchAction: snap === 'full' ? 'pan-y' : 'none',
          paddingBottom: 24,
        }}
      >
        {children}
      </div>
    </div>
  );
}
