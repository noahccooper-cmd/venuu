import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSelfieCapture } from '../../hooks/useSelfieCapture';
import { hapticLight, hapticMedium } from '../../lib/haptics';
import { VIBE_HUES } from '../../lib/hueMath';
import PolaroidHeader from './PolaroidHeader';
import HueSpectrum2D from './HueSpectrum2D';
import CameraFrame, { type CameraFrameHandle } from './CameraFrame';

interface CaptureSurfaceProps {
  open: boolean;
  venueId: string;
  venueName: string;
  onClose: () => void;
}

/**
 * Restore last-used hue from localStorage (decision #5 — slider
 * remembers your hue). Returns default if nothing stored.
 */
function loadLastHue(): { degrees: number; lightness: number } {
  try {
    const raw = localStorage.getItem('venuu_last_hue');
    if (!raw) return { degrees: 30, lightness: 55 }; // default = warm orange brand
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.degrees === 'number' &&
      typeof parsed.lightness === 'number'
    ) {
      return parsed;
    }
  } catch {}
  return { degrees: 30, lightness: 55 };
}

function saveLastHue(degrees: number, lightness: number) {
  try {
    localStorage.setItem(
      'venuu_last_hue',
      JSON.stringify({ degrees, lightness })
    );
  } catch {}
}

function nearestHueName(degrees: number): string {
  // Find the VIBE_HUES bucket closest to current degrees
  let best = VIBE_HUES[0];
  let bestDist = 999;
  for (const h of VIBE_HUES) {
    // Circular distance on hue wheel
    const raw = Math.abs(h.degrees - degrees);
    const dist = Math.min(raw, 360 - raw);
    if (dist < bestDist) {
      bestDist = dist;
      best = h;
    }
  }
  return best.name.toLowerCase();
}

export default function CaptureSurface({
  open, venueId, venueName, onClose,
}: CaptureSurfaceProps) {
  const selfie = useSelfieCapture();
  const cameraRef = useRef<CameraFrameHandle>(null);

  const initial = loadLastHue();
  const [hueDegrees,   setHueDegrees]   = useState(initial.degrees);
  const [hueLightness, setHueLightness] = useState(initial.lightness);
  const [showFlash, setShowFlash]       = useState(false);
  const [headerTriggerKey, setHeaderTriggerKey] = useState(0);

  // Request camera stream when surface opens
  useEffect(() => {
    if (open) {
      // venueId is consumed by the Phase 3 (49c) submit pipeline; logged
      // here so Phase 1 dev testing surfaces which venue we opened against
      // (and so the reserved prop isn't an unused-binding compile error).
      console.log('[CaptureSurface] opening for venue', venueId, '— requesting stream');
      selfie.requestStream();
      setHeaderTriggerKey(k => k + 1);
    } else {
      console.log('[CaptureSurface] closing, stopping stream');
      selfie.reset();
    }
    // We deliberately omit selfie from deps — its identity changes
    // every render and we only want this effect on open transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleHueChange = useCallback((deg: number, light: number) => {
    setHueDegrees(deg);
    setHueLightness(light);
    saveLastHue(deg, light);
  }, []);

  const handleShutter = useCallback(async () => {
    const videoEl = cameraRef.current?.getVideoElement();
    if (!videoEl || selfie.status !== 'streaming') {
      console.warn('[CaptureSurface] shutter blocked', {
        hasVideo: !!videoEl, status: selfie.status,
      });
      return;
    }
    hapticMedium();
    setShowFlash(true);
    await selfie.captureFrame(videoEl);
    setTimeout(() => setShowFlash(false), 400);
  }, [selfie]);

  const handleRetake = useCallback(() => {
    hapticLight();
    selfie.reset();
    selfie.requestStream();
  }, [selfie]);

  // ── Permission denied state ─────────────────────────────────
  const renderPermissionDenied = () => (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px',
      textAlign: 'center',
    }}>
      <div style={{
        fontSize: '32px',
        marginBottom: '16px',
        color: `hsl(${hueDegrees}, 85%, ${hueLightness}%)`,
      }}>
        {'✦'}
      </div>
      <div style={{
        fontFamily: 'var(--font-cursive)',
        fontSize: '28px',
        color: '#fff',
        marginBottom: '12px',
      }}>
        camera access needed
      </div>
      <div style={{
        fontFamily: 'Satoshi, sans-serif',
        fontSize: '13px',
        color: 'rgba(255,255,255,0.6)',
        marginBottom: '24px',
        maxWidth: '300px',
        lineHeight: 1.5,
      }}>
        venuu needs camera access to capture your moment.
        Go to Settings → venuu → Camera → Allow.
      </div>
      <button
        onClick={onClose}
        style={{
          padding: '12px 24px',
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: '12px',
          color: '#fff',
          fontFamily: 'Satoshi, sans-serif',
          fontSize: '12px',
          fontWeight: 700,
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        close
      </button>
    </div>
  );

  // ── Captured-frame holding state (Phase 1 visual stub) ──
  const renderCapturedState = () => (
    <div style={{
      position: 'absolute',
      bottom: '24%',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.65)',
      backdropFilter: 'blur(12px)',
      border: `1px solid hsl(${hueDegrees}, 80%, ${hueLightness}%)`,
      borderRadius: '14px',
      padding: '12px 20px',
      color: '#fff',
      fontFamily: 'Satoshi, sans-serif',
      fontSize: '11px',
      letterSpacing: '1.5px',
      textTransform: 'uppercase',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      zIndex: 50,
    }}>
      <span style={{ color: `hsl(${hueDegrees}, 85%, ${hueLightness}%)`, fontSize: '16px' }}>
        {'✦'}
      </span>
      <span>frame captured · phase 1 stub</span>
      <button
        onClick={handleRetake}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'rgba(255,255,255,0.7)',
          fontFamily: 'inherit',
          fontSize: '10px',
          fontWeight: 700,
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
          cursor: 'pointer',
          padding: '2px 6px',
          textDecoration: 'underline',
        }}
      >
        retake
      </button>
    </div>
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9000,
            // Subtle radial gradient — depth, not flat black
            background: `radial-gradient(ellipse at center,
              hsla(${hueDegrees}, 30%, 8%, 1) 0%,
              rgba(0,0,0,1) 70%)`,
            transition: 'background 0.4s ease',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            // No safe-area padding here — handled inside child sections
            // so flex layout has the full screen to work with.
          }}
        >
          {/* Close button — top right, subtle */}
          <button
            onClick={() => { hapticLight(); onClose(); }}
            style={{
              position: 'absolute',
              top: 'calc(env(safe-area-inset-top) + 14px)',
              right: '18px',
              zIndex: 100,
              width: '36px', height: '36px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.7)',
              fontSize: '18px',
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
            }}
          >
            ✕
          </button>

          {/* Permission-denied takes over the surface */}
          {selfie.status === 'permission_denied' || selfie.status === 'unsupported'
            ? renderPermissionDenied()
            : (
            <>
              {/* Camera region — flexible but capped so bottom controls always show */}
              <div style={{
                flex: '1 1 auto',
                minHeight: 0,           // allows flex shrink past content size
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                paddingTop: '20px',
                overflow: 'hidden',
              }}>
                <PolaroidHeader
                  venueName={venueName}
                  hueDegrees={hueDegrees}
                  hueLightness={hueLightness}
                  triggerKey={headerTriggerKey}
                />

                <CameraFrame
                  ref={cameraRef}
                  stream={selfie.stream}
                  hueDegrees={hueDegrees}
                  hueLightness={hueLightness}
                  capturedFrame={selfie.capturedFrame}
                  showFlash={showFlash}
                />

                {selfie.status === 'captured' && renderCapturedState()}
              </div>

              {/* Bottom controls — fixed bottom, never pushed off screen */}
              <div style={{
                width: '100%',
                padding: '0 24px',
                paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '18px',
                flexShrink: 0,        // Never let this section compress
                background: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)',
                paddingTop: '20px',
              }}>
                {/* Dynamic prompt — "the hill feels like crimson" */}
                <div style={{
                  fontFamily: 'var(--font-cursive)',
                  fontSize: '17px',
                  color: `hsl(${hueDegrees}, 80%, ${Math.min(75, hueLightness + 10)}%)`,
                  textAlign: 'center',
                  transition: 'color 0.2s ease',
                  opacity: 0.92,
                  minHeight: '24px',
                }}>
                  {venueName.toLowerCase()} feels like {nearestHueName(hueDegrees)}
                </div>

                {/* The 2D slider */}
                <HueSpectrum2D
                  hueDegrees={hueDegrees}
                  hueLightness={hueLightness}
                  onChange={handleHueChange}
                  width={Math.min(360, window.innerWidth - 48)}
                />

                {/* Shutter button */}
                <motion.button
                  onClick={handleShutter}
                  disabled={selfie.status !== 'streaming'}
                  whileTap={{ scale: 0.9 }}
                  animate={
                    selfie.status === 'streaming'
                      ? {
                          boxShadow: [
                            `0 0 0 0 hsla(${hueDegrees}, 90%, ${hueLightness}%, 0.6)`,
                            `0 0 0 20px hsla(${hueDegrees}, 90%, ${hueLightness}%, 0)`,
                          ],
                        }
                      : { boxShadow: '0 0 0 0 rgba(0,0,0,0)' }
                  }
                  transition={{
                    boxShadow: { duration: 1.8, repeat: Infinity, ease: 'easeOut' },
                  }}
                  style={{
                    width: '88px',
                    height: '88px',
                    borderRadius: '50%',
                    // Solid filled center — clearly visible as a button
                    background: `radial-gradient(circle,
                      hsla(${hueDegrees}, 85%, ${hueLightness}%, 0.95) 0%,
                      hsla(${hueDegrees}, 85%, ${hueLightness}%, 0.7) 60%,
                      hsla(${hueDegrees}, 85%, ${hueLightness}%, 0.5) 100%)`,
                    // White inner ring for the iPhone-camera-style affordance
                    border: '4px solid white',
                    boxShadow: `0 0 32px hsla(${hueDegrees}, 90%, ${hueLightness}%, 0.6)`,
                    cursor: selfie.status === 'streaming' ? 'pointer' : 'not-allowed',
                    opacity: selfie.status === 'streaming' ? 1 : 0.5,
                    transition: 'background 0.18s, opacity 0.2s, border-color 0.18s',
                    // Make absolutely sure it's interactive
                    pointerEvents: 'auto',
                    position: 'relative',
                    zIndex: 10,
                  }}
                />
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
