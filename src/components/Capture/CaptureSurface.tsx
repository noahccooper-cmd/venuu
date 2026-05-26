import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSelfieCapture } from '../../hooks/useSelfieCapture';
import { hapticLight, hapticMedium } from '../../lib/haptics';
import { VIBE_HUES } from '../../lib/hueMath';
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
  const [warming, setWarming] = useState(false);
  const [mirrorFlash, setMirrorFlash] = useState(false);
  const [showIntroWordmark, setShowIntroWordmark] = useState(false);
  const [showNumberReveal, setShowNumberReveal] = useState(false);
  const [chamberVisible, setChamberVisible] = useState(false);
  const [frameVisible, setFrameVisible] = useState(false);

  // Request camera stream when surface opens
  useEffect(() => {
    if (open) {
      // venueId is consumed by the Phase 3 (49c) submit pipeline; logged
      // here so Phase 1 dev testing surfaces which venue we opened against
      // (and so the reserved prop isn't an unused-binding compile error).
      console.log('[CaptureSurface] opening for venue', venueId, '— starting cinematic sequence');

      // BEAT 1: 0-1200ms — BLACK SCREEN with "venuu" wordmark only
      // The chamber + camera are HIDDEN during this beat (chamberVisible
      // and frameVisible stay false). Pure cinematic intro.
      setShowIntroWordmark(true);
      setChamberVisible(false);
      setFrameVisible(false);

      // Stream request fires now so it's ready when frame reveals
      selfie.requestStream();

      // BEAT 2: 1200ms — wordmark fades, chamber blooms in
      const t_chamber = setTimeout(() => {
        setShowIntroWordmark(false);
        setChamberVisible(true);
      }, 1200);

      // BEAT 3: 1500ms — frame + camera fade up underneath
      const t_frame = setTimeout(() => {
        setFrameVisible(true);
      }, 1500);

      // BEAT 4: 1900ms — warmup shimmer + Polaroid header types
      const t_warmup = setTimeout(() => {
        setWarming(true);
        setHeaderTriggerKey(k => k + 1);
      }, 1900);

      const t_warmup_end = setTimeout(() => {
        setWarming(false);
      }, 1900 + 950);

      // BEAT 5: 2600ms — number reveals last, the eternal mark
      const t_number = setTimeout(() => {
        setShowNumberReveal(true);
      }, 2600);

      return () => {
        clearTimeout(t_chamber);
        clearTimeout(t_frame);
        clearTimeout(t_warmup);
        clearTimeout(t_warmup_end);
        clearTimeout(t_number);
      };
    } else {
      console.log('[CaptureSurface] closing');
      selfie.reset();
      setWarming(false);
      setShowIntroWordmark(false);
      setShowNumberReveal(false);
      setChamberVisible(false);
      setFrameVisible(false);
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
    setMirrorFlash(true);
    await selfie.captureFrame(videoEl);
    setTimeout(() => setShowFlash(false), 400);
    setTimeout(() => setMirrorFlash(false), 600);

    // Auto-compose the JPEG after the frame is captured.
    // 49b uses momentNumber={1} placeholder. 49c will fetch the
    // real number from submit_moment RPC return value.
    await selfie.compose({
      hueDegrees,
      hueLightness,
      venueName,
      momentNumber: 1,
    });
  }, [selfie, hueDegrees, hueLightness, venueName]);

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

  // ── Captured-frame holding state (Phase 2: composite preview) ──
  const renderCapturedState = () => (
    <>
      {selfie.status === 'composing' && (
        <div style={{
          position: 'absolute',
          bottom: '20%',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(12px)',
          border: `1px solid hsl(${hueDegrees}, 80%, ${hueLightness}%)`,
          borderRadius: '14px',
          padding: '12px 20px',
          color: '#fff',
          fontFamily: 'Satoshi, sans-serif',
          fontSize: '11px',
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
          zIndex: 50,
        }}>
          composing your moment...
        </div>
      )}

      {selfie.status === 'composed' && selfie.composedPreviewURL && (
        <div style={{
          position: 'absolute',
          bottom: '14%',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(12px)',
          border: `1px solid var(--venuu-pearl)`,
          borderRadius: '14px',
          padding: '14px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          alignItems: 'center',
          zIndex: 50,
          maxWidth: '280px',
        }}>
          <div style={{
            color: 'var(--venuu-pearl)',
            fontFamily: 'var(--font-cursive)',
            fontSize: '20px',
            letterSpacing: '0.5px',
            lineHeight: 1,
          }}>
            ✦ your moment
          </div>
          <div style={{
            color: 'rgba(255,255,255,0.6)',
            fontFamily: 'Satoshi, sans-serif',
            fontSize: '10px',
            letterSpacing: '1.2px',
            textTransform: 'uppercase',
            textAlign: 'center',
          }}>
            composite ready · phase 2 preview
          </div>
          <img
            src={selfie.composedPreviewURL}
            alt="Composed moment preview"
            style={{
              width: '100%',
              maxWidth: '220px',
              aspectRatio: '9/16',
              borderRadius: '8px',
              objectFit: 'cover',
              boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            }}
          />
          <button
            onClick={handleRetake}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: '8px',
              color: 'rgba(255,255,255,0.8)',
              fontFamily: 'Satoshi, sans-serif',
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              cursor: 'pointer',
              padding: '8px 16px',
            }}
          >
            retake
          </button>
        </div>
      )}
    </>
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
            background: '#000',  // pure black base; chamber layer below applies the hue
            transition: 'background 0.4s ease',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-start',
          }}
        >
          {/* THE CHAMBER — three-layer hue bloom that washes the entire
              surface in the user's chosen feeling. The phone becomes the
              room. The room becomes the moment. */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 0,
              pointerEvents: 'none',
              opacity: chamberVisible ? 1 : 0,
              transition: 'opacity 700ms ease-out',
              overflow: 'hidden',
            }}
          >
            {/* Layer 1: ambient screen tint — the room's base color */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: `linear-gradient(180deg,
                  hsla(${hueDegrees}, ${Math.min(60, hueLightness + 5)}%, 8%, 0.55) 0%,
                  hsla(${hueDegrees}, ${Math.min(50, hueLightness)}%, 5%, 0.35) 50%,
                  hsla(${hueDegrees}, ${Math.min(60, hueLightness + 5)}%, 8%, 0.55) 100%)`,
                transition: 'background 0.25s ease',
              }}
            />

            {/* Layer 2: corner blooms — four soft hue halos in each corner */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: `
                  radial-gradient(ellipse 60% 50% at 0% 0%,
                    hsla(${hueDegrees}, 85%, ${Math.min(70, hueLightness + 10)}%, 0.18) 0%,
                    transparent 70%),
                  radial-gradient(ellipse 60% 50% at 100% 0%,
                    hsla(${hueDegrees}, 85%, ${Math.min(70, hueLightness + 10)}%, 0.18) 0%,
                    transparent 70%),
                  radial-gradient(ellipse 60% 50% at 0% 100%,
                    hsla(${hueDegrees}, 85%, ${Math.min(70, hueLightness + 10)}%, 0.22) 0%,
                    transparent 70%),
                  radial-gradient(ellipse 60% 50% at 100% 100%,
                    hsla(${hueDegrees}, 85%, ${Math.min(70, hueLightness + 10)}%, 0.22) 0%,
                    transparent 70%)`,
                transition: 'background 0.25s ease',
              }}
            />

            {/* Layer 3: center halo behind the camera frame — the photo's
                light reflecting back into the room */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: `radial-gradient(circle at center,
                  hsla(${hueDegrees}, 80%, ${Math.min(60, hueLightness + 5)}%, 0.15) 0%,
                  hsla(${hueDegrees}, 70%, ${hueLightness}%, 0.05) 30%,
                  transparent 60%)`,
                transition: 'background 0.25s ease',
              }}
            />
          </div>

          {/* Mirror flash — chamber-wide bloom when shutter fires.
              The room briefly fills with your color, like a flashbulb
              went off and the walls caught the light. */}
          {mirrorFlash && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 5,
                background: `radial-gradient(circle at center,
                  hsla(${hueDegrees}, 95%, ${Math.min(80, hueLightness + 20)}%, 0.72) 0%,
                  hsla(${hueDegrees}, 90%, ${Math.min(78, hueLightness + 12)}%, 0.48) 35%,
                  hsla(${hueDegrees}, 85%, ${hueLightness}%, 0.18) 70%,
                  transparent 100%)`,
                animation: 'mirror-flash 600ms ease-out forwards',
                mixBlendMode: 'screen',
              }}
            />
          )}

          {/* Intro wordmark — "venuu" writes itself across the screen on
              open, fades as the chamber and camera settle in. */}
          {showIntroWordmark && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 50,
                pointerEvents: 'none',
                animation: 'wordmark-fade 1200ms ease-out forwards',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-cursive)',
                  fontSize: '92px',
                  fontWeight: 600,
                  color: 'var(--venuu-pearl)',
                  letterSpacing: '2px',
                  textShadow: `
                    0 0 24px rgba(255, 248, 231, 0.85),
                    0 0 48px rgba(255, 248, 231, 0.6),
                    0 0 96px rgba(255, 248, 231, 0.3)
                  `,
                  animation: 'pearl-shimmer 4s ease-in-out infinite',
                }}
              >
                venuu
              </div>
            </div>
          )}

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
              {/* Camera region — fades up after wordmark + chamber */}
              <div style={{
                flex: '1 1 auto',
                minHeight: 0,
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                padding: '16px 0 24px',
                overflow: 'hidden',
                opacity: frameVisible ? 1 : 0,
                transition: 'opacity 600ms ease-out',
              }}>
                <CameraFrame
                  ref={cameraRef}
                  stream={selfie.stream}
                  hueDegrees={hueDegrees}
                  hueLightness={hueLightness}
                  capturedFrame={selfie.capturedFrame}
                  showFlash={showFlash}
                  venueName={venueName}
                  headerTriggerKey={headerTriggerKey}
                  warming={warming}
                  momentNumber={1}
                  showNumberReveal={showNumberReveal}
                />

                {(selfie.status === 'captured' || selfie.status === 'composing' || selfie.status === 'composed') && renderCapturedState()}
              </div>

              {/* Bottom controls — fades up with the camera frame */}
              <div style={{
                width: '100%',
                padding: '0 24px',
                paddingBottom: 'calc(env(safe-area-inset-bottom) + 18px)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '14px',
                flexShrink: 0,        // Never let this section compress
                background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 100%)',
                paddingTop: '14px',
                opacity: frameVisible ? 1 : 0,
                transition: 'opacity 600ms ease-out',
              }}>
                {/* Emotional thesis — the moment in one cursive sentence */}
                <div style={{
                  fontFamily: 'var(--font-cursive)',
                  fontSize: '22px',
                  fontWeight: 500,
                  color: `hsl(${hueDegrees}, 85%, ${Math.min(78, hueLightness + 12)}%)`,
                  textAlign: 'center',
                  transition: 'color 0.2s ease, text-shadow 0.2s ease',
                  opacity: 0.95,
                  minHeight: '32px',
                  letterSpacing: '0.4px',
                  lineHeight: 1.2,
                  textShadow: `0 0 18px hsla(${hueDegrees}, 90%, ${Math.min(80, hueLightness + 15)}%, 0.45)`,
                  padding: '0 16px',
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
