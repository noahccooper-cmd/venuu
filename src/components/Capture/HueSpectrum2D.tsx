import { useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { hapticTick } from '../../lib/haptics';

interface HueSpectrum2DProps {
  /** Current hue degrees, 0-360 */
  hueDegrees: number;
  /** Current lightness, 30-70 */
  hueLightness: number;
  onChange: (degrees: number, lightness: number) => void;
  /** Width of the spectrum area in pixels */
  width: number;
}

/**
 * Full 2D color field — drag anywhere to tune hue (x) and lightness (y).
 *
 * x-axis: 0° (left) → 360° (right), wrapping through the spectrum
 * y-axis: 70% lightness (top, brighter) → 30% lightness (bottom, darker)
 *
 * No knob — the indicator pulses subtly to show position. Spring
 * physics on settle.
 */
export default function HueSpectrum2D({
  hueDegrees, hueLightness, onChange, width,
}: HueSpectrum2DProps) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const HEIGHT = 96;

  // Track which hue bucket we're currently in so we can fire a
  // haptic tick when the user crosses boundaries. 14 buckets means
  // each bucket is ~25.7°.
  const lastBucketRef = useRef<number>(Math.floor(hueDegrees / 25.7));

  useEffect(() => {
    const currentBucket = Math.floor(hueDegrees / 25.7);
    if (currentBucket !== lastBucketRef.current) {
      hapticTick();
      lastBucketRef.current = currentBucket;
    }
  }, [hueDegrees]);

  // Compute indicator position from current hue/lightness
  const xPct = (hueDegrees / 360) * 100;
  const yPct = ((70 - hueLightness) / 40) * 100;

  const handlePosition = useCallback((clientX: number, clientY: number) => {
    const rect = fieldRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(0, Math.min(rect.width,  clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    const degrees   = Math.round((x / rect.width) * 360);
    const lightness = Math.round(70 - (y / rect.height) * 40);
    onChange(degrees, lightness);
  }, [onChange]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true;
    fieldRef.current?.setPointerCapture(e.pointerId);
    handlePosition(e.clientX, e.clientY);
  }, [handlePosition]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    handlePosition(e.clientX, e.clientY);
  }, [handlePosition]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false;
    try { fieldRef.current?.releasePointerCapture(e.pointerId); } catch {}
  }, []);

  return (
    <div
      ref={fieldRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: 'relative',
        width: `${width}px`,
        height: `${HEIGHT}px`,
        borderRadius: '14px',
        touchAction: 'none',
        overflow: 'hidden',
        cursor: 'crosshair',
        background: `
          linear-gradient(to bottom,
            rgba(255,255,255,0.4) 0%,
            rgba(255,255,255,0) 50%,
            rgba(0,0,0,0.4) 100%),
          linear-gradient(to right,
            hsl(0, 80%, 50%),
            hsl(60, 80%, 50%),
            hsl(120, 80%, 50%),
            hsl(180, 80%, 50%),
            hsl(240, 80%, 50%),
            hsl(300, 80%, 50%),
            hsl(360, 80%, 50%))
        `,
        boxShadow: '0 4px 24px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.06)',
      }}
    >
      {/* Position indicator — subtle pulsing dot in active color */}
      <motion.div
        animate={{ left: `${xPct}%`, top: `${yPct}%` }}
        transition={{ type: 'spring', stiffness: 600, damping: 32 }}
        style={{
          position: 'absolute',
          width: '24px',
          height: '24px',
          marginLeft: '-12px',
          marginTop: '-12px',
          borderRadius: '50%',
          border: '2.5px solid white',
          background: `hsl(${hueDegrees}, 85%, ${hueLightness}%)`,
          boxShadow: `0 0 18px hsla(${hueDegrees}, 90%, ${hueLightness}%, 0.85), 0 0 0 1px rgba(0,0,0,0.4)`,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
