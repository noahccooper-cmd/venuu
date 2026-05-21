// src/components/Paint/PaintScreen.tsx
//
// Phase D: Rate-on-Exit paint screen — v2 (interaction + polish fixes).
//
// Soul Doc compliance:
//   - ZERO words above the slider. No labels. No category names.
//     Color is the only language.
//   - 14-hue gradient slider (calm left → intensity right)
//   - Thumb starts neutral grey, fills with the landed hue on release
//   - First paint is permanent (UNIQUE(user_id, venue_id) in vibe_ratings)
//
// v2 fixes:
//   - Pointer capture happens on the TRACK ref directly, not on e.target.
//     This ensures iOS captures the pointer to the track regardless of
//     where on the slider the touch lands.
//   - Layout restructured: header top, slider center, button bottom-anchored
//     with safe-area padding. No more clipping.
//   - Visual polish: bigger thumb, inner ring, track inner shadow,
//     stronger "paint" button presence, radial bg gradient.

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { VIBE_HUES, type VibeHueId } from '../../lib/hueMath';

interface PaintScreenProps {
  open: boolean;
  onClose: () => void;
  paintPromptId: string | null;
  venueId: string;
  venueName: string;
  visitTimeRangeLabel: string;
  onPainted: (hueId: VibeHueId) => void;
}

const SLIDER_HEIGHT_PX = 80;
const THUMB_SIZE_PX = 64;

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

  // CRITICAL: pointer handlers operate on the SLIDER REF, not on the
  // event target. This means we get pointer-down/move/up regardless
  // of which child element the touch starts on.
  const updateFromClientX = useCallback((clientX: number) => {
    const rect = sliderRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setSliderPct(pct);
    setHasLanded(true);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragActiveRef.current = true;
    // Capture on the SLIDER element, not e.target. This is the iOS fix.
    sliderRef.current?.setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  }, [updateFromClientX]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragActiveRef.current) return;
    updateFromClientX(e.clientX);
  }, [updateFromClientX]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragActiveRef.current = false;
    try {
      sliderRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* ignore */ }
  }, []);

  // Mark prompt as opened
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

  // Reset state when screen closes
  useEffect(() => {
    if (!open) {
      setSliderPct(null);
      setHasLanded(false);
      setSubmitting(false);
      dragActiveRef.current = false;
    }
  }, [open]);

  const handlePaint = async () => {
    if (!landedHueId || submitting) return;
    setSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('not signed in');

      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('auth_id', user.id)
        .single();

      if (!profile) throw new Error('profile not found');

      const { data: rating, error: rateErr } = await supabase
        .from('vibe_ratings')
        .insert({
          user_id: profile.id,
          venue_id: venueId,
          hue_id: landedHueId,
        })
        .select('id')
        .single();

      if (rateErr && rateErr.code !== '23505') {
        console.error('[PaintScreen] paint insert failed', rateErr);
        setSubmitting(false);
        return;
      }

      if (paintPromptId) {
        await supabase.from('paint_prompts')
          .update({
            status: 'painted',
            painted_at: new Date().toISOString(),
            vibe_rating_id: rating?.id ?? null,
          })
          .eq('id', paintPromptId);
      }

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

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[9000] flex flex-col"
          style={{
            background: 'radial-gradient(ellipse at center, rgb(15,15,18) 0%, rgb(0,0,0) 80%)',
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          {/* Dismiss X — top-right, low emphasis */}
          <div className="flex justify-end px-6 pt-4">
            <button
              onClick={handleDismiss}
              className="text-white/25 hover:text-white/60 text-3xl leading-none p-3 -m-3"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>

          {/* Main content — header + slider, vertically centered */}
          <div className="flex-1 flex flex-col items-center justify-center px-6">
            {/* Venue header */}
            <div className="text-center mb-20">
              <h1 className="text-white text-[40px] leading-[1.1] font-bold tracking-tight mb-3">
                {venueName}
              </h1>
              <p className="text-white/40 text-[15px] tracking-wide font-medium">
                {visitTimeRangeLabel}
              </p>
            </div>

            {/* The slider. NO label above. Color is the only language. */}
            <div className="w-full max-w-md">
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
                  boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.4), 0 0 60px rgba(255,255,255,0.05)',
                  filter: hasLanded ? 'saturate(1.15)' : 'saturate(0.9)',
                  transition: 'filter 250ms ease-out',
                }}
              >
                {/* Thumb */}
                <motion.div
                  initial={false}
                  animate={{
                    left: sliderPct === null ? '50%' : `${sliderPct}%`,
                    backgroundColor: hasLanded && hueCSS ? hueCSS : 'rgb(195,195,195)',
                    scale: hasLanded ? 1.0 : 0.9,
                  }}
                  transition={{
                    left: { type: 'spring', stiffness: 380, damping: 28 },
                    backgroundColor: { duration: 0.22 },
                    scale: { duration: 0.22 },
                  }}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
                  style={{
                    width: THUMB_SIZE_PX,
                    height: THUMB_SIZE_PX,
                    boxShadow: hasLanded && hueCSS
                      ? `0 0 0 4px rgba(0,0,0,0.85), 0 0 0 6px rgba(255,255,255,0.95), 0 0 40px ${hueCSS}cc, 0 8px 20px rgba(0,0,0,0.6)`
                      : '0 0 0 4px rgba(0,0,0,0.85), 0 0 0 6px rgba(255,255,255,0.95), 0 8px 20px rgba(0,0,0,0.6)',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Paint button — bottom-anchored with comfortable breathing room */}
          <div className="px-6 pb-8 flex justify-center">
            <button
              onClick={handlePaint}
              disabled={!hasLanded || submitting}
              className="w-full max-w-md py-6 rounded-full text-white text-[19px] font-bold tracking-wider uppercase transition-all duration-300 disabled:cursor-not-allowed"
              style={{
                backgroundColor: hasLanded && hueCSS ? hueCSS : 'rgba(255,255,255,0.06)',
                color: hasLanded ? 'white' : 'rgba(255,255,255,0.25)',
                boxShadow: hasLanded && hueCSS
                  ? `0 0 60px ${hueCSS}80, 0 0 30px ${hueCSS}40, inset 0 1px 1px rgba(255,255,255,0.2)`
                  : 'none',
                opacity: submitting ? 0.7 : 1,
                letterSpacing: '0.15em',
              }}
            >
              {submitting ? 'painting' : 'paint'}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
