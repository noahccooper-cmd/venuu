// src/components/Paint/PaintCeremony.tsx
//
// Phase E — the FULL induction ceremony. 7 seconds. Sacred.
//
// Timeline (7.0s total):
//   0.0-0.35s : PaintScreen exits via parent fade
//   0.35-1.05s: BEAT 1 — Travel. flyTo venue (700ms ease).
//               Camera lands at zoom 16, pitch 45.
//   1.05-2.20s: BEAT 2 — Approach. Map continues deeper to zoom 17.5.
//               Surrounding venues dim to 25% via overlay.
//   2.20-3.80s: BEAT 3 — The mark. THUMP at venue (white-hot pulse 0→3x).
//               STATEMENT bloom radiates across viewport in hue.
//               PERMANENCE ring expands outward.
//               "moment N" cursive declaration appears center-screen
//               in pearlescent cream-gold (fades in 400ms, holds).
//   3.80-5.00s: BEAT 4 — Floating ✦#N. Small pearl ✦#N rises from
//               venue marker upward 80px, holds briefly.
//   5.00-6.20s: BEAT 5 — Wake. Cursive declaration fades (400ms).
//               Bloom settles. Surrounding dim begins lifting.
//   6.20-7.00s: BEAT 6 — Return. Map zooms back 0.5 to zoom 17.
//               Surroundings fully restored.

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Map as MapboxMap } from 'mapbox-gl';
import { VIBE_HUES, type VibeHueId } from '../../lib/hueMath';
import { numberToCursiveWord } from '../../lib/numberToCursiveWord';

interface PaintCeremonyProps {
  open: boolean;
  hueId: VibeHueId | null;
  venue: { id: string; name: string; lat: number; lng: number } | null;
  map: MapboxMap | null;
  /** User's personal moment number — engraved on JPEG + declared
   *  in the ceremony. Pass null for legacy flows that don't have
   *  the number (the ceremony will skip the declaration beat). */
  momentNumber: number | null;
  onComplete: () => void;
}

// Beat durations — sum to 7000ms
const CEREMONY_DURATION_MS  = 7000;
const TRAVEL_DELAY_MS       = 350;
const TRAVEL_DURATION_MS    = 700;     // 1.05s landed
const APPROACH_DELAY_MS     = 1050;
const APPROACH_DURATION_MS  = 1150;    // 2.20s landed
// Declaration timing within MARK beat
const DECLARATION_DELAY_MS  = 2400;    // declaration arrives during the thump
const DECLARATION_HOLD_MS   = 2400;    // holds through wake
// Floating ✦#N timing
const FLOATING_DELAY_MS     = 3800;
const FLOATING_DURATION_MS  = 1200;    // 5.00s landed
// Return timing
const RETURN_DELAY_MS       = 6200;
const RETURN_DURATION_MS    = 800;

export default function PaintCeremony({
  open, hueId, venue, map, momentNumber, onComplete,
}: PaintCeremonyProps) {
  const startedRef = useRef(false);
  const [cameraSettled, setCameraSettled] = useState(false);
  const [showDeclaration, setShowDeclaration] = useState(false);
  const [showFloating, setShowFloating] = useState(false);
  const [showSurroundingsDim, setShowSurroundingsDim] = useState(false);

  useEffect(() => {
    if (!open || !hueId || !venue || !map || startedRef.current) return;
    startedRef.current = true;
    setCameraSettled(false);
    setShowDeclaration(false);
    setShowFloating(false);
    setShowSurroundingsDim(false);

    // BEAT 1 — Travel
    const t_travel = setTimeout(() => {
      try {
        map.flyTo({
          center: [venue.lng, venue.lat],
          zoom: 16,
          pitch: 45,
          bearing: 0,
          duration: TRAVEL_DURATION_MS,
          essential: true,
        });
        map.once('moveend', () => setCameraSettled(true));
      } catch (err) {
        console.warn('[PaintCeremony] flyTo failed', err);
        setCameraSettled(true);
      }
    }, TRAVEL_DELAY_MS);

    // BEAT 2 — Approach. Zoom deeper, dim surroundings.
    const t_approach = setTimeout(() => {
      setShowSurroundingsDim(true);
      try {
        map.flyTo({
          center: [venue.lng, venue.lat],
          zoom: 17.5,
          pitch: 50,
          bearing: 0,
          duration: APPROACH_DURATION_MS,
          essential: true,
        });
      } catch (err) {
        console.warn('[PaintCeremony] approach flyTo failed', err);
      }
    }, APPROACH_DELAY_MS);

    // BEAT 3 — Declaration appears (during the mark thump). The mark
    // bloom itself is anchored to the VenueBloomOverlay's mount time,
    // which fires once cameraSettled flips true (around MARK_DELAY).
    const t_declaration = setTimeout(() => {
      setShowDeclaration(true);
    }, DECLARATION_DELAY_MS);

    // BEAT 4 — Floating ✦#N rises
    const t_floating = setTimeout(() => {
      setShowFloating(true);
    }, FLOATING_DELAY_MS);

    // BEAT 5 — Declaration fades (controlled via animation exit)
    const t_declaration_fade = setTimeout(() => {
      setShowDeclaration(false);
    }, DECLARATION_DELAY_MS + DECLARATION_HOLD_MS);

    // BEAT 5 — Floating fades
    const t_floating_fade = setTimeout(() => {
      setShowFloating(false);
    }, FLOATING_DELAY_MS + FLOATING_DURATION_MS);

    // BEAT 6 — Return. Zoom back, restore surroundings.
    const t_return = setTimeout(() => {
      setShowSurroundingsDim(false);
      try {
        map.flyTo({
          center: [venue.lng, venue.lat],
          zoom: 17,
          pitch: 45,
          bearing: 0,
          duration: RETURN_DURATION_MS,
          essential: true,
        });
      } catch (err) {
        console.warn('[PaintCeremony] return flyTo failed', err);
      }
    }, RETURN_DELAY_MS);

    const t_complete = setTimeout(() => {
      startedRef.current = false;
      setCameraSettled(false);
      setShowDeclaration(false);
      setShowFloating(false);
      setShowSurroundingsDim(false);
      onComplete();
    }, CEREMONY_DURATION_MS);

    return () => {
      clearTimeout(t_travel);
      clearTimeout(t_approach);
      clearTimeout(t_declaration);
      clearTimeout(t_floating);
      clearTimeout(t_declaration_fade);
      clearTimeout(t_floating_fade);
      clearTimeout(t_return);
      clearTimeout(t_complete);
    };
  }, [open, hueId, venue, map, onComplete]);

  if (!open || !hueId || !venue) return null;

  const hue = VIBE_HUES.find((h) => h.id === hueId);
  if (!hue) return null;

  const hueCSS = `hsl(${hue.degrees}, ${hue.defaultSat}%, 50%)`;
  const hueCSSBright = `hsl(${hue.degrees}, ${hue.defaultSat}%, 60%)`;
  const hueCSSAlpha = `hsla(${hue.degrees}, ${hue.defaultSat}%, 50%, 0.6)`;

  // The cursive declaration text — "moment one", "moment fifteen", etc.
  const declarationText = momentNumber != null
    ? `moment ${numberToCursiveWord(momentNumber)}`
    : null;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Fade-from-black overlay */}
          <motion.div
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.5, delay: 0.35 }}
            className="fixed inset-0 z-[8500] bg-black pointer-events-none"
          />

          {/* Surrounding-venues dim overlay — slight darken everywhere
              except the venue's neighborhood. We do this with a radial
              gradient that's transparent at venue center, darkening
              outward. Below the bloom in z-order. */}
          <AnimatePresence>
            {showSurroundingsDim && cameraSettled && map && (
              <SurroundingsDim
                map={map}
                venue={venue}
              />
            )}
          </AnimatePresence>

          {/* Bloom + thump + permanence — mounted once camera lands. */}
          {map && cameraSettled && (
            <VenueBloomOverlay
              map={map}
              venue={venue}
              hueCSS={hueCSS}
              hueCSSBright={hueCSSBright}
              hueCSSAlpha={hueCSSAlpha}
            />
          )}

          {/* BEAT 3-5 — Cursive declaration center-screen */}
          <AnimatePresence>
            {showDeclaration && declarationText && (
              <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.04 }}
                transition={{
                  opacity: { duration: 0.4, ease: 'easeOut' },
                  scale:   { duration: 0.4, ease: [0.34, 1.56, 0.64, 1] },
                }}
                className="fixed pointer-events-none z-[8600]"
                style={{
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  fontFamily: 'var(--font-cursive)',
                  fontSize: '88px',
                  fontWeight: 600,
                  color: 'var(--venuu-pearl)',
                  letterSpacing: '1.5px',
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                  textShadow: `
                    0 0 24px rgba(255, 248, 231, 0.85),
                    0 0 48px rgba(255, 248, 231, 0.55),
                    0 0 96px rgba(255, 248, 231, 0.30)
                  `,
                  animation: 'pearl-shimmer 5s ease-in-out infinite',
                }}
              >
                {declarationText}
              </motion.div>
            )}
          </AnimatePresence>

          {/* BEAT 4 — Floating ✦#N from venue marker */}
          <AnimatePresence>
            {showFloating && map && cameraSettled && momentNumber != null && (
              <FloatingMomentNumber
                map={map}
                venue={venue}
                momentNumber={momentNumber}
              />
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>
  );
}

// ───────────────────────────────────────────────────────────────
// SurroundingsDim — radial dim everywhere except venue center
// ───────────────────────────────────────────────────────────────

function SurroundingsDim({
  map, venue,
}: {
  map: MapboxMap;
  venue: { lat: number; lng: number };
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!map) return;
    const update = () => {
      try {
        const p = map.project([venue.lng, venue.lat]);
        setPos({ x: p.x, y: p.y });
      } catch {}
    };
    update();
    map.on('move', update);
    map.on('zoom', update);
    return () => {
      map.off('move', update);
      map.off('zoom', update);
    };
  }, [map, venue.lat, venue.lng]);

  if (!pos) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="fixed inset-0 pointer-events-none z-[8390]"
      style={{
        background: `radial-gradient(circle 320px at ${pos.x}px ${pos.y}px,
          transparent 0%,
          transparent 40%,
          rgba(0, 0, 0, 0.45) 100%)`,
      }}
    />
  );
}

// ───────────────────────────────────────────────────────────────
// FloatingMomentNumber — small ✦#N rises from venue marker
// ───────────────────────────────────────────────────────────────

function FloatingMomentNumber({
  map, venue, momentNumber,
}: {
  map: MapboxMap;
  venue: { lat: number; lng: number };
  momentNumber: number;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!map) return;
    const update = () => {
      try {
        const p = map.project([venue.lng, venue.lat]);
        setPos({ x: p.x, y: p.y });
      } catch {}
    };
    update();
    map.on('move', update);
    map.on('zoom', update);
    return () => {
      map.off('move', update);
      map.off('zoom', update);
    };
  }, [map, venue.lat, venue.lng]);

  if (!pos) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 0, scale: 0.7 }}
      animate={{ opacity: 1, y: -80, scale: 1 }}
      exit={{ opacity: 0, y: -100, scale: 0.95 }}
      transition={{
        opacity: { duration: 0.5, ease: 'easeOut' },
        y:       { duration: 0.9, ease: [0.22, 1, 0.36, 1] },
        scale:   { duration: 0.5, ease: [0.34, 1.56, 0.64, 1] },
      }}
      className="fixed pointer-events-none z-[8550]"
      style={{
        left: pos.x,
        top: pos.y,
        transform: 'translate(-50%, -50%)',
        display: 'flex',
        alignItems: 'baseline',
        gap: '4px',
        fontFamily: 'var(--font-cursive)',
      }}
    >
      <span
        style={{
          fontSize: '22px',
          color: 'var(--venuu-pearl)',
          lineHeight: 1,
          textShadow: `
            0 0 8px rgba(255, 248, 231, 0.9),
            0 0 18px rgba(255, 252, 239, 0.6)
          `,
        }}
      >
        ✦
      </span>
      <span
        style={{
          fontSize: '32px',
          fontWeight: 700,
          color: 'var(--venuu-pearl)',
          lineHeight: 1,
          textShadow: `
            0 0 10px rgba(255, 248, 231, 0.92),
            0 0 24px rgba(255, 252, 239, 0.65),
            0 0 40px rgba(255, 248, 231, 0.32)
          `,
        }}
      >
        #{momentNumber}
      </span>
    </motion.div>
  );
}

// ───────────────────────────────────────────────────────────────
// VenueBloomOverlay — thump + bloom + permanence ring
// Durations slightly extended (STATEMENT 2.6s → 3.4s, PERMANENCE
// 2.0s → 2.5s) to breathe with the slower 7s ceremony pacing.
// ───────────────────────────────────────────────────────────────

function VenueBloomOverlay({
  map, venue, hueCSS, hueCSSBright, hueCSSAlpha,
}: {
  map: MapboxMap;
  venue: { lat: number; lng: number };
  hueCSS: string;
  hueCSSBright: string;
  hueCSSAlpha: string;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!map) return;
    const update = () => {
      try {
        const p = map.project([venue.lng, venue.lat]);
        setPos({ x: p.x, y: p.y });
      } catch {}
    };
    update();
    map.on('move', update);
    map.on('zoom', update);
    return () => {
      map.off('move', update);
      map.off('zoom', update);
    };
  }, [map, venue.lat, venue.lng]);

  if (!pos) return null;

  return (
    <>
      {/* THUMP — small intense pulse at exact venue point */}
      <motion.div
        initial={{ opacity: 0, scale: 0 }}
        animate={{
          opacity: [0, 1, 1, 0],
          scale: [0, 1, 1.4, 1.6],
        }}
        transition={{
          duration: 0.7,
          delay: 0,
          times: [0, 0.3, 0.8, 1],
          ease: 'easeOut',
        }}
        className="fixed pointer-events-none z-[8410]"
        style={{
          left: pos.x,
          top: pos.y,
          width: 80,
          height: 80,
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle, ${hueCSSBright} 0%, ${hueCSS} 50%, transparent 80%)`,
          borderRadius: '50%',
          boxShadow: `0 0 60px ${hueCSS}, 0 0 100px ${hueCSSAlpha}`,
        }}
      />

      {/* STATEMENT — massive radial bloom radiating outward */}
      <motion.div
        initial={{ opacity: 0, scale: 0.3 }}
        animate={{
          opacity: [0, 0.92, 0.92, 0],
          scale: [0.3, 1.4, 2.2, 2.6],
        }}
        transition={{
          duration: 3.4,
          delay: 0.4,
          times: [0, 0.2, 0.75, 1],
          ease: [0.22, 1, 0.36, 1],
        }}
        className="fixed pointer-events-none z-[8400]"
        style={{
          left: pos.x,
          top: pos.y,
          width: 900,
          height: 900,
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle, ${hueCSS} 0%, ${hueCSSAlpha} 30%, transparent 70%)`,
          filter: 'blur(28px)',
          mixBlendMode: 'screen',
        }}
      />

      {/* PERMANENCE ring — thin outer ring expands and fades */}
      <motion.div
        initial={{ opacity: 0, scale: 0.1 }}
        animate={{
          opacity: [0, 0.5, 0],
          scale: [0.1, 1.0, 1.8],
        }}
        transition={{
          duration: 2.5,
          delay: 0.5,
          times: [0, 0.4, 1],
          ease: 'easeOut',
        }}
        className="fixed pointer-events-none z-[8405]"
        style={{
          left: pos.x,
          top: pos.y,
          width: 600,
          height: 600,
          transform: 'translate(-50%, -50%)',
          borderRadius: '50%',
          border: `2px solid ${hueCSS}`,
          boxShadow: `0 0 40px ${hueCSSAlpha}, inset 0 0 40px ${hueCSSAlpha}`,
        }}
      />
    </>
  );
}
