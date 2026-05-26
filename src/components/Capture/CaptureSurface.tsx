import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSelfieCapture } from '../../hooks/useSelfieCapture';
import { hapticLight, hapticMedium } from '../../lib/haptics';
import { VIBE_HUES } from '../../lib/hueMath';
import { saveMomentToPhotos, type SaveStatus } from '../../lib/saveMomentToPhotos';
import { useMomentSubmit } from '../../hooks/useMomentSubmit';
import HueSpectrum2D from './HueSpectrum2D';
import CameraFrame, { type CameraFrameHandle } from './CameraFrame';

interface CaptureSurfaceProps {
  open: boolean;
  venueId: string;
  venueName: string;
  username: string | null;
  /** Fires after MARK pipeline completes successfully. Triggers
   *  PaintCeremony in App.tsx. */
  onPainted: (hueId: number, recapId: string, momentNumber: number) => void;
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
  open, venueId, venueName, username, onPainted, onClose,
}: CaptureSurfaceProps) {
  const selfie = useSelfieCapture();
  const submit = useMomentSubmit();
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

  // Captured hue — frozen at shutter time. The chamber locks to
  // this hue once the moment is committed, so the slider's
  // current position no longer affects the chamber.
  const [committedHue, setCommittedHue] = useState<{
    degrees: number;
    lightness: number;
  } | null>(null);

  // Save-to-photos status
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  // Active hue for visual elements — the slider's hue when tuning,
  // the captured hue when committed. The chamber + frame + glow
  // freeze at capture time so the post-capture state feels stable.
  const activeHue = committedHue ?? { degrees: hueDegrees, lightness: hueLightness };
  const activeHueDeg = activeHue.degrees;
  const activeHueLight = activeHue.lightness;

  // Composed-state gate — true from the moment of shutter onward,
  // covers capturing → composing → composed (until retake or close).
  const isComposed =
    selfie.status === 'composed' ||
    selfie.status === 'composing' ||
    selfie.status === 'captured';

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

    // Snapshot the hue NOW — this becomes the moment's permanent color
    setCommittedHue({ degrees: hueDegrees, lightness: hueLightness });

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
    setCommittedHue(null);
    setSaveStatus('idle');
    submit.reset();
    selfie.reset();
    selfie.requestStream();
  }, [selfie, submit]);

  const handleSaveToPhotos = useCallback(async () => {
    if (!selfie.composedBlob) {
      console.warn('[CaptureSurface] save called without composed blob');
      return;
    }
    hapticLight();
    setSaveStatus('saving');
    const result = await saveMomentToPhotos(selfie.composedBlob, venueName);
    setSaveStatus(result.status);
    if (result.status === 'success') {
      hapticMedium();
      // Auto-reset to idle after 2.5s so the button can be tapped again
      setTimeout(() => setSaveStatus('idle'), 2500);
    } else if (result.status === 'cancelled') {
      // User dismissed the share sheet — silent reset, NOT an error.
      // No alert, no haptic, just return to idle.
      setTimeout(() => setSaveStatus('idle'), 300);
    } else if (result.status === 'permission_denied') {
      alert('Photos save permission denied.\n\nGo to: Settings → venuu → Photos → Add Photos Only\n\nThen tap Save again.');
    } else if (result.status === 'error') {
      alert(`Share failed: ${result.error || 'Unknown error'}`);
    }
  }, [selfie.composedBlob, venueName]);

  const handleMark = useCallback(async () => {
    if (!selfie.composedBlob || !selfie.capturedFrame) {
      console.warn('[CaptureSurface] MARK called without composed blob');
      alert('Capture not ready. Please retake.');
      return;
    }
    if (!username) {
      console.warn('[CaptureSurface] MARK called without username');
      alert('Please sign in to capture moments.');
      return;
    }

    hapticMedium();

    // Use the committed (captured) hue, not the current slider position
    const submitDegrees = committedHue?.degrees ?? hueDegrees;
    const submitLightness = committedHue?.lightness ?? hueLightness;

    const result = await submit.submit({
      blob: selfie.composedBlob,
      capturedFrame: selfie.capturedFrame,
      venueId,
      venueName,
      username,
      hueDegrees: submitDegrees,
      hueLightness: submitLightness,
    });

    if (result) {
      hapticMedium();
      // Close surface, then fire ceremony with the hueId + recapId + momentNumber
      onPainted(result.hueId, result.recapId, result.momentNumber);
    } else {
      // Error already surfaced in submit.error via alert paths
      // below. Just leave user on COMPOSED state to retry or retake.
      if (submit.error && submit.errorCode !== 'unknown') {
        // Specific actionable errors get an alert
        alert(submit.error);
      } else if (submit.error) {
        // Unknown errors get the raw message
        alert(`Submit failed: ${submit.error}`);
      }
    }
  }, [
    selfie.composedBlob,
    selfie.capturedFrame,
    username,
    venueId,
    venueName,
    committedHue,
    hueDegrees,
    hueLightness,
    submit,
    onPainted,
  ]);

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
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
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
                  hsla(${activeHueDeg}, ${Math.min(60, activeHueLight + 5)}%, 8%, 0.55) 0%,
                  hsla(${activeHueDeg}, ${Math.min(50, activeHueLight)}%, 5%, 0.35) 50%,
                  hsla(${activeHueDeg}, ${Math.min(60, activeHueLight + 5)}%, 8%, 0.55) 100%)`,
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
                    hsla(${activeHueDeg}, 85%, ${Math.min(70, activeHueLight + 10)}%, 0.18) 0%,
                    transparent 70%),
                  radial-gradient(ellipse 60% 50% at 100% 0%,
                    hsla(${activeHueDeg}, 85%, ${Math.min(70, activeHueLight + 10)}%, 0.18) 0%,
                    transparent 70%),
                  radial-gradient(ellipse 60% 50% at 0% 100%,
                    hsla(${activeHueDeg}, 85%, ${Math.min(70, activeHueLight + 10)}%, 0.22) 0%,
                    transparent 70%),
                  radial-gradient(ellipse 60% 50% at 100% 100%,
                    hsla(${activeHueDeg}, 85%, ${Math.min(70, activeHueLight + 10)}%, 0.22) 0%,
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
                  hsla(${activeHueDeg}, 80%, ${Math.min(60, activeHueLight + 5)}%, 0.15) 0%,
                  hsla(${activeHueDeg}, 70%, ${activeHueLight}%, 0.05) 30%,
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
              {/* Camera region — visible only during TUNING state */}
              {!isComposed && (
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
                </div>
              )}

              {/* Composed state — clean committed UI */}
              {isComposed && (
                <div style={{
                  flex: '1 1 auto',
                  minHeight: 0,
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  padding: '24px 0 16px',
                  overflow: 'hidden',
                  gap: '20px',
                }}>
                  {/* "✦ moment captured" header */}
                  <div style={{
                    fontFamily: 'var(--font-cursive)',
                    fontSize: '28px',
                    fontWeight: 600,
                    color: 'var(--venuu-pearl)',
                    letterSpacing: '0.5px',
                    textShadow: `
                      0 0 16px rgba(255, 248, 231, 0.7),
                      0 0 32px rgba(255, 248, 231, 0.4)
                    `,
                    animation: 'pearl-shimmer 5s ease-in-out infinite',
                  }}>
                    ✦ moment captured
                  </div>

                  {/* The composed JPEG — the artifact */}
                  {selfie.composedPreviewURL && (
                    <div style={{
                      width: '74%',
                      maxWidth: '300px',
                      aspectRatio: '9/16',
                      borderRadius: '20px',
                      overflow: 'hidden',
                      boxShadow: `
                        0 0 0 1px rgba(255, 248, 231, 0.18),
                        0 0 28px rgba(255, 248, 231, 0.32),
                        0 0 64px rgba(255, 248, 231, 0.18),
                        0 8px 40px rgba(0, 0, 0, 0.6)
                      `,
                    }}>
                      <img
                        src={selfie.composedPreviewURL}
                        alt="Your moment"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block',
                        }}
                      />
                    </div>
                  )}

                  {/* "develops at 8am tomorrow" subline */}
                  <div style={{
                    fontFamily: 'Satoshi, sans-serif',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: 'rgba(255, 255, 255, 0.55)',
                    letterSpacing: '2px',
                    textTransform: 'uppercase',
                    textAlign: 'center',
                  }}>
                    develops at 8am tomorrow
                  </div>

                  {/* Composing state — shown while canvas renders */}
                  {selfie.status === 'composing' && (
                    <div style={{
                      fontFamily: 'var(--font-cursive)',
                      fontSize: '16px',
                      color: 'var(--venuu-pearl)',
                      opacity: 0.7,
                    }}>
                      composing your moment...
                    </div>
                  )}
                </div>
              )}

              {/* Bottom controls — TUNING state (slider + prompt + shutter) */}
              {!isComposed && (
                <div style={{
                  width: '100%',
                  padding: '0 24px',
                  paddingBottom: 'calc(env(safe-area-inset-bottom) + 18px)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '14px',
                  flexShrink: 0,
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

                  {/* Shutter button — primary action in tuning state */}
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
                      background: `radial-gradient(circle,
                        hsla(${hueDegrees}, 85%, ${hueLightness}%, 0.95) 0%,
                        hsla(${hueDegrees}, 85%, ${hueLightness}%, 0.7) 60%,
                        hsla(${hueDegrees}, 85%, ${hueLightness}%, 0.5) 100%)`,
                      border: '4px solid white',
                      boxShadow: `0 0 32px hsla(${hueDegrees}, 90%, ${hueLightness}%, 0.6)`,
                      cursor: selfie.status === 'streaming' ? 'pointer' : 'not-allowed',
                      opacity: selfie.status === 'streaming' ? 1 : 0.5,
                      transition: 'background 0.18s, opacity 0.2s, border-color 0.18s',
                      pointerEvents: 'auto',
                      position: 'relative',
                      zIndex: 10,
                    }}
                  />
                </div>
              )}

              {/* Bottom controls — COMPOSED state (action buttons) */}
              {isComposed && selfie.status === 'composed' && (
                <div style={{
                  width: '100%',
                  padding: '0 28px',
                  paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '14px',
                  flexShrink: 0,
                  paddingTop: '14px',
                }}>
                  {/* MARK SUNSPOT — primary action, glows in captured hue */}
                  <button
                    onClick={handleMark}
                    disabled={
                      submit.status === 'uploading' ||
                      submit.status === 'submitting' ||
                      submit.status === 'recomposing' ||
                      submit.status === 'reuploading' ||
                      submit.status === 'recording_paint'
                    }
                    style={{
                      width: '100%',
                      maxWidth: '320px',
                      padding: '18px 24px',
                      background: `linear-gradient(180deg,
                        hsla(${activeHueDeg}, 85%, ${activeHueLight}%, 0.92) 0%,
                        hsla(${activeHueDeg}, 85%, ${activeHueLight}%, 0.78) 100%)`,
                      border: `2px solid hsl(${activeHueDeg}, 90%, ${Math.min(80, activeHueLight + 10)}%)`,
                      borderRadius: '16px',
                      color: '#fff',
                      fontFamily: 'Satoshi, sans-serif',
                      fontSize: '15px',
                      fontWeight: 800,
                      letterSpacing: '2px',
                      textTransform: 'uppercase',
                      cursor: (
                        submit.status === 'uploading' ||
                        submit.status === 'submitting' ||
                        submit.status === 'recomposing' ||
                        submit.status === 'reuploading' ||
                        submit.status === 'recording_paint'
                      ) ? 'wait' : 'pointer',
                      opacity: (
                        submit.status === 'uploading' ||
                        submit.status === 'submitting' ||
                        submit.status === 'recomposing' ||
                        submit.status === 'reuploading' ||
                        submit.status === 'recording_paint'
                      ) ? 0.8 : 1,
                      boxShadow: `
                        0 0 28px hsla(${activeHueDeg}, 90%, ${activeHueLight}%, 0.5),
                        0 6px 24px rgba(0, 0, 0, 0.4)
                      `,
                      transition: 'transform 0.15s, box-shadow 0.15s, opacity 0.2s',
                    }}
                  >
                    {submit.status === 'uploading'        && '↑ uploading...'}
                    {submit.status === 'submitting'       && '✦ committing your moment...'}
                    {submit.status === 'recomposing'      && '✦ engraving your number...'}
                    {submit.status === 'reuploading'      && '↑ finalizing...'}
                    {submit.status === 'recording_paint'  && '✦ painting the venue...'}
                    {submit.status === 'idle' && `✦ mark ${venueName.toLowerCase()}`}
                    {submit.status === 'success' && '✓ marked'}
                    {submit.status === 'error' && `✦ mark ${venueName.toLowerCase()} · retry`}
                  </button>

                  {/* SAVE TO PHOTOS — secondary, neutral */}
                  <button
                    onClick={handleSaveToPhotos}
                    disabled={saveStatus === 'saving' || saveStatus === 'success'}
                    style={{
                      width: '100%',
                      maxWidth: '320px',
                      padding: '14px 24px',
                      background: saveStatus === 'success'
                        ? 'rgba(80, 200, 120, 0.18)'
                        : 'rgba(255, 255, 255, 0.08)',
                      border: saveStatus === 'success'
                        ? '1px solid rgba(80, 200, 120, 0.4)'
                        : '1px solid rgba(255, 255, 255, 0.18)',
                      borderRadius: '14px',
                      color: saveStatus === 'success' ? 'rgba(80, 220, 140, 1)' : 'rgba(255, 255, 255, 0.85)',
                      fontFamily: 'Satoshi, sans-serif',
                      fontSize: '12px',
                      fontWeight: 700,
                      letterSpacing: '1.8px',
                      textTransform: 'uppercase',
                      cursor: saveStatus === 'saving' ? 'wait' : 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    {saveStatus === 'saving' && 'saving...'}
                    {saveStatus === 'success' && '✓ saved'}
                    {saveStatus === 'permission_denied' && 'permission denied'}
                    {saveStatus === 'error' && 'save failed · retry'}
                    {(saveStatus === 'idle' || saveStatus === 'unsupported' || saveStatus === 'cancelled') && 'save to photos'}
                  </button>

                  {/* retake — tertiary, smallest */}
                  <button
                    onClick={handleRetake}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'rgba(255, 255, 255, 0.5)',
                      fontFamily: 'Satoshi, sans-serif',
                      fontSize: '11px',
                      fontWeight: 700,
                      letterSpacing: '1.5px',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      padding: '8px 16px',
                      textDecoration: 'underline',
                      textUnderlineOffset: '4px',
                    }}
                  >
                    retake
                  </button>
                </div>
              )}
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
