// src/components/Paint/PaintScreen.tsx
//
// Phase D: Rate-on-Exit paint screen.
//
// Soul Doc compliance:
//   - ZERO words above the slider. No labels. No category names. No emoji.
//     Color is the only language.
//   - 14-hue gradient slider (calm left → intensity right)
//   - Thumb starts neutral grey, fills with the landed hue on release
//   - Three seconds. One slide. One tap.
//   - First paint is permanent (UNIQUE(user_id, venue_id) in vibe_ratings)
//
// Mounts as a full-screen modal when:
//   1. Push tap deep-link arrives with data.type === 'paint_prompt' (primary)
//   2. (Future) User taps a queued prompt from a "pending paints" tray
//
// Props:
//   open, onClose, paintPromptId, venueId, venueName,
//   visitTimeRangeLabel, onPainted
//
// Lifecycle writes:
//   - On mount with paintPromptId: status pushed → opened
//   - On paint success: vibe_ratings INSERT, paint_prompts → painted
//   - On dismiss X: paint_prompts → dismissed
//   - On already-painted (23505): silent no-op, treat as success

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
  visitTimeRangeLabel: string;  // "Wed · 9:48pm–11:22pm"
  onPainted: (hueId: VibeHueId) => void;
}

const SLIDER_HEIGHT_PX = 72;
const THUMB_SIZE_PX = 56;

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

  // Compute the landed hue id (1-14) from slider percentage
  const landedHueId: VibeHueId | null = sliderPct === null
    ? null
    : (Math.max(1, Math.min(14, Math.round((sliderPct / 100) * 13 + 1))) as VibeHueId);

  const landedHue = landedHueId
    ? VIBE_HUES.find((h) => h.id === landedHueId) ?? null
    : null;

  // Full 14-hue gradient as CSS for the track
  const trackGradient = `linear-gradient(to right, ${
    VIBE_HUES.map((h, i) =>
      `hsl(${h.degrees}, ${h.defaultSat}%, 50%) ${(i / 13) * 100}%`
    ).join(', ')
  })`;

  const handleSliderChange = useCallback((clientX: number) => {
    const rect = sliderRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setSliderPct(pct);
    setHasLanded(true);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    handleSliderChange(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).hasPointerCapture(e.pointerId)) {
      handleSliderChange(e.clientX);
    }
  };

  // Mark prompt as opened (only transitions pushed → opened)
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
    }
  }, [open]);

  const handlePaint = async () => {
    if (!landedHueId || submitting) return;
    setSubmitting(true);

    try {
      // Resolve profile.id from current auth user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('not signed in');

      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('auth_id', user.id)
        .single();

      if (!profile) throw new Error('profile not found');

      // Insert vibe_rating. UNIQUE(user_id, venue_id) enforces permanence.
      const { data: rating, error: rateErr } = await supabase
        .from('vibe_ratings')
        .insert({
          user_id: profile.id,
          venue_id: venueId,
          hue_id: landedHueId,
        })
        .select('id')
        .single();

      // 23505 = unique_violation = already painted. Treat as idempotent success.
      if (rateErr && rateErr.code !== '23505') {
        console.error('[PaintScreen] paint insert failed', rateErr);
        setSubmitting(false);
        return;
      }

      // Mark paint_prompt as painted (link to the rating)
      if (paintPromptId) {
        await supabase.from('paint_prompts')
          .update({
            status: 'painted',
            painted_at: new Date().toISOString(),
            vibe_rating_id: rating?.id ?? null,
          })
          .eq('id', paintPromptId);
      }

      // Hand off to PaintCeremony (parent decides the animation)
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

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[9000] bg-black flex flex-col items-center justify-center px-6"
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          {/* Dismiss X (top-right). Low-emphasis — most users will paint. */}
          <button
            onClick={handleDismiss}
            className="absolute right-6 text-white/30 hover:text-white/70 text-3xl leading-none p-2"
            style={{ top: 'calc(env(safe-area-inset-top) + 1rem)' }}
            aria-label="Dismiss"
          >
            ×
          </button>

          {/* Venue header — name + time range. The ONLY text on screen. */}
          <div className="text-center mb-16">
            <h1 className="text-white text-3xl font-semibold tracking-tight mb-2">
              {venueName}
            </h1>
            <p className="text-white/50 text-sm tracking-wide">
              {visitTimeRangeLabel}
            </p>
          </div>

          {/* The slider. NO label above. NO categories. NO descriptors.
              The gradient itself teaches the language. */}
          <div className="w-full max-w-md mb-12">
            <div
              ref={sliderRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              className="relative cursor-grab active:cursor-grabbing rounded-full overflow-visible"
              style={{
                height: `${SLIDER_HEIGHT_PX}px`,
                background: trackGradient,
                touchAction: 'none',
              }}
            >
              {/* Thumb. Neutral grey until user releases on a hue. */}
              <motion.div
                initial={false}
                animate={{
                  left: sliderPct === null ? '50%' : `${sliderPct}%`,
                  backgroundColor: hasLanded && landedHue
                    ? `hsl(${landedHue.degrees}, ${landedHue.defaultSat}%, 50%)`
                    : 'rgb(180, 180, 180)',
                  scale: hasLanded ? 1.0 : 0.88,
                }}
                transition={{
                  left: { type: 'spring', stiffness: 400, damping: 30 },
                  backgroundColor: { duration: 0.2 },
                  scale: { duration: 0.2 },
                }}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white shadow-2xl pointer-events-none"
                style={{ width: THUMB_SIZE_PX, height: THUMB_SIZE_PX }}
              />
            </div>
          </div>

          {/* Paint button. Disabled until thumb lands. Bg = landed hue. */}
          <button
            onClick={handlePaint}
            disabled={!hasLanded || submitting}
            className="w-full max-w-md py-5 rounded-full text-white text-lg font-semibold tracking-wide transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              backgroundColor: hasLanded && landedHue
                ? `hsl(${landedHue.degrees}, ${landedHue.defaultSat}%, 50%)`
                : 'rgb(60, 60, 60)',
              boxShadow: hasLanded && landedHue
                ? `0 0 40px hsla(${landedHue.degrees}, ${landedHue.defaultSat}%, 50%, 0.6)`
                : 'none',
            }}
          >
            {submitting ? 'painting…' : 'paint'}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
