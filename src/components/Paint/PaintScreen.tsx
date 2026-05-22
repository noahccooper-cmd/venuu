// src/components/Paint/PaintScreen.tsx
//
// Phase D v3 — the sacred painting moment, polished.
//
// Visual decisions:
//   - Venue header anchored top-third of screen, name MASSIVE (52px),
//     time below in elegant small caps tracking. The event is announced.
//   - Slider: thinner track (56px not 80px), refined thumb (60px),
//     subtle inner shadow + outer glow. Feels like a paint chooser,
//     not an iOS volume slider.
//   - Paint button: bigger circular pill (not full-width bar), 320px max,
//     elevated above safe area with breathing room. "PAINT" in
//     letter-spaced bold caps. Glows in your chosen hue.
//   - Background: subtle radial gradient (slight lift at center).

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { VIBE_HUES, type VibeHueId } from '../../lib/hueMath';
import CaptureModule from './CaptureModule';
import { useCaptureMoment } from '../../hooks/useCaptureMoment';

interface PaintScreenProps {
  open: boolean;
  onClose: () => void;
  paintPromptId: string | null;
  venueId: string;
  venueName: string;
  visitTimeRangeLabel: string;
  onPainted: (hueId: VibeHueId) => void;
}

const SLIDER_HEIGHT_PX = 56;
const THUMB_SIZE_PX = 60;

export default function PaintScreen({
  open,
  onClose,
  paintPromptId,
  venueId,
  venueName,
  visitTimeRangeLabel,
  onPainted,
}: PaintScreenProps) {
  const [sliderPct, setSliderPct] = useState<number | null>(null);
  const [hasLanded, setHasLanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);
  const dragActiveRef = useRef(false);

  const capture = useCaptureMoment();
  const [paintUsername, setPaintUsername] = useState<string | null>(null);

  const landedHueId: VibeHueId | null = sliderPct === null
    ? null
    : (Math.max(1, Math.min(14, Math.round((sliderPct / 100) * 13 + 1))) as VibeHueId);

  const landedHue = landedHueId
    ? VIBE_HUES.find((h) => h.id === landedHueId) ?? null
    : null;

  const trackGradient = `linear-gradient(to right, ${
    VIBE_HUES.map((h, i) =>
      `hsl(${h.degrees}, ${h.defaultSat}%, 50%) ${(i / 13) * 100}%`
    ).join(', ')
  })`;

  const updateFromClientX = useCallback((clientX: number) => {
    const rect = sliderRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setSliderPct(pct);
    setHasLanded(true);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragActiveRef.current = true;
    sliderRef.current?.setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  }, [updateFromClientX]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragActiveRef.current) return;
    updateFromClientX(e.clientX);
  }, [updateFromClientX]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragActiveRef.current = false;
    try { sliderRef.current?.releasePointerCapture(e.pointerId); } catch {}
  }, []);

  useEffect(() => {
    if (open && paintPromptId) {
      supabase.from('paint_prompts')
        .update({ status: 'opened', opened_at: new Date().toISOString() })
        .eq('id', paintPromptId)
        .eq('status', 'pushed')
        .then(({ error }) => {
          if (error) console.warn('[PaintScreen] opened mark failed', error);
        });
    }
  }, [open, paintPromptId]);

  useEffect(() => {
    if (!open) {
      setSliderPct(null);
      setHasLanded(false);
      setSubmitting(false);
      dragActiveRef.current = false;
      // Drop any captured-but-unsubmitted photo so it can't leak into
      // the next venue's paint session.
      capture.reset();
    }
  }, [open]);

  // Fetch username once for the submit_moment call
  useEffect(() => {
    if (!open) return;
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      if (!u) return;
      supabase
        .from('profiles')
        .select('username')
        .eq('auth_id', u.id)
        .maybeSingle()
        .then(({ data: profile }) => {
          if (profile?.username) setPaintUsername(profile.username);
        });
    });
  }, [open]);

  const handlePaint = async () => {
    if (!landedHueId || !landedHue || submitting) return;
    setSubmitting(true);

    const hasPhoto = capture.status === 'preview' && !!capture.capturedDataUrl;

    try {
      // 1. If a photo was captured, upload + submit the moment first.
      //    A recoverable failure (already_crowned, upload, etc.) falls
      //    back to paint-only — the vibe contribution shouldn't be held
      //    hostage by photo issues.
      if (hasPhoto && paintUsername) {
        const result = await capture.submitMoment(
          venueId,
          paintUsername,
          landedHue.degrees,
        );
        if (!result.success) {
          console.warn('[moment] submit failed:', result.error);
          capture.reset();
        }
      }

      // 2. Paint contribution (existing flow — record_paint unchanged).
      const { data: ratingId, error: rpcErr } = await supabase.rpc('record_paint', {
        p_venue_id: venueId,
        p_hue_id: landedHueId,
        p_visit_first_seen_at: new Date().toISOString(),
        p_paint_prompt_id: paintPromptId,
      });

      if (rpcErr) {
        console.error('[PaintScreen] record_paint RPC failed', rpcErr);
        setSubmitting(false);
        return;
      }

      console.log('[PaintScreen] paint recorded, rating_id=', ratingId);
      onPainted(landedHueId);
    } catch (err) {
      console.error('[PaintScreen] paint flow error', err);
      setSubmitting(false);
    }
  };

  const handleDismiss = async () => {
    if (paintPromptId) {
      await supabase.from('paint_prompts')
        .update({ status: 'dismissed', dismissed_at: new Date().toISOString() })
        .eq('id', paintPromptId);
    }
    onClose();
  };

  const hueCSS = landedHue
    ? `hsl(${landedHue.degrees}, ${landedHue.defaultSat}%, 50%)`
    : null;

  const buttonLabel = (capture.status === 'preview' && capture.capturedDataUrl)
    ? 'paint + capture'
    : 'paint';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          className="fixed inset-0 z-[9000] flex flex-col"
          style={{
            background: 'radial-gradient(ellipse at top center, rgb(20,20,24) 0%, rgb(0,0,0) 70%)',
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          {/* Dismiss X */}
          <div className="flex justify-end px-6 pt-3">
            <button
              onClick={handleDismiss}
              className="text-white/20 hover:text-white/60 text-3xl leading-none p-3 -m-3 transition-opacity"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>

          {/* Venue header — top third, anchored */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-center px-6 pt-12"
          >
            <h1 className="text-white text-[52px] leading-[1.02] font-bold tracking-tight mb-4" style={{ letterSpacing: '-0.02em' }}>
              {venueName}
            </h1>
            <p className="text-white/35 text-[13px] font-medium uppercase" style={{ letterSpacing: '0.18em' }}>
              {visitTimeRangeLabel}
            </p>
          </motion.div>

          {/* Slider — centered in remaining space */}
          <div className="flex-1 flex items-center justify-center px-7">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.25 }}
              className="w-full max-w-[380px]"
            >
              <div
                ref={sliderRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                className="relative rounded-full cursor-grab active:cursor-grabbing select-none"
                style={{
                  height: `${SLIDER_HEIGHT_PX}px`,
                  background: trackGradient,
                  touchAction: 'none',
                  boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.5), 0 0 80px rgba(255,255,255,0.04)',
                  filter: hasLanded ? 'saturate(1.2)' : 'saturate(0.85)',
                  transition: 'filter 280ms ease-out',
                }}
              >
                <motion.div
                  initial={false}
                  animate={{
                    left: sliderPct === null ? '50%' : `${sliderPct}%`,
                    backgroundColor: hasLanded && hueCSS ? hueCSS : 'rgb(220,220,225)',
                    scale: hasLanded ? 1.0 : 0.85,
                  }}
                  transition={{
                    left: { type: 'spring', stiffness: 400, damping: 30 },
                    backgroundColor: { duration: 0.2 },
                    scale: { duration: 0.2 },
                  }}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
                  style={{
                    width: THUMB_SIZE_PX,
                    height: THUMB_SIZE_PX,
                    boxShadow: hasLanded && hueCSS
                      ? `0 0 0 3px rgba(0,0,0,0.95), 0 0 0 5px rgba(255,255,255,1), 0 0 50px ${hueCSS}, 0 10px 24px rgba(0,0,0,0.7)`
                      : '0 0 0 3px rgba(0,0,0,0.95), 0 0 0 5px rgba(255,255,255,1), 0 10px 24px rgba(0,0,0,0.7)',
                  }}
                />
              </div>
            </motion.div>
          </div>

          {/* Capture module — appears once a hue is landed (auth users only) */}
          {landedHue && paintUsername && (
            <div className="flex justify-center px-7">
              <CaptureModule
                landedHue={landedHue}
                capture={capture}
                onPhotoReady={() => { /* no-op — preview state managed by capture hook */ }}
                onClear={() => capture.reset()}
              />
            </div>
          )}

          {/* Paint button — pill, not full-width bar */}
          <div className="flex justify-center pb-10">
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              onClick={handlePaint}
              disabled={!hasLanded || submitting}
              whileTap={hasLanded ? { scale: 0.96 } : {}}
              className="rounded-full text-white font-bold uppercase transition-all duration-300 disabled:cursor-not-allowed"
              style={{
                minWidth: '200px',
                padding: '20px 56px',
                fontSize: '17px',
                letterSpacing: '0.22em',
                backgroundColor: hasLanded && hueCSS ? hueCSS : 'rgba(255,255,255,0.05)',
                color: hasLanded ? 'white' : 'rgba(255,255,255,0.2)',
                boxShadow: hasLanded && hueCSS
                  ? `0 0 80px ${hueCSS}90, 0 0 40px ${hueCSS}60, inset 0 1px 0 rgba(255,255,255,0.25), 0 14px 30px rgba(0,0,0,0.5)`
                  : 'inset 0 1px 0 rgba(255,255,255,0.05)',
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? 'painting' : buttonLabel}
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
