// src/components/Paint/PaintCeremony.tsx
//
// Phase D v2 — the FULL ceremony. Sacred. Slow enough to feel.
//
// Timeline (4.2s total):
//   0.0–0.35s : PaintScreen exits via parent fade
//   0.35–1.05s: Camera flies to venue (700ms ease). flyTo + onceMoveEnd
//               anchors the bloom position correctly (fixes "wrong location" bug)
//   1.05–1.45s: THUMP — bubble at venue lat/lng explodes 0→3x scale in user's hue,
//               white-hot ring expands rapidly
//   1.45–3.05s: STATEMENT — radial bloom radiates outward across the whole
//               viewport in user's hue. Holds at peak for 1.6 seconds.
//               This is the moment the area is THEIRS.
//   3.05–3.85s: SETTLE — bloom retreats inward, bubble shrinks to normal
//   3.85–4.20s: linger, return control

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Map as MapboxMap } from 'mapbox-gl';
import { VIBE_HUES, type VibeHueId } from '../../lib/hueMath';

interface PaintCeremonyProps {
  open: boolean;
  hueId: VibeHueId | null;
  venue: { id: string; name: string; lat: number; lng: number } | null;
  map: MapboxMap | null;
  onComplete: () => void;
}

const CEREMONY_DURATION_MS = 4200;
const CAMERA_FLY_DELAY_MS = 350;
const CAMERA_FLY_DURATION_MS = 700;

export default function PaintCeremony({
  open,
  hueId,
  venue,
  map,
  onComplete,
}: PaintCeremonyProps) {
  const startedRef = useRef(false);
  const [cameraSettled, setCameraSettled] = useState(false);

  useEffect(() => {
    if (!open || !hueId || !venue || !map || startedRef.current) return;
    startedRef.current = true;
    setCameraSettled(false);

    const flyTimeout = setTimeout(() => {
      try {
        map.flyTo({
          center: [venue.lng, venue.lat],
          zoom: 16,
          pitch: 45,
          bearing: 0,
          duration: CAMERA_FLY_DURATION_MS,
          essential: true,
        });
        // Defer bloom mount until projection has settled at new center.
        map.once('moveend', () => setCameraSettled(true));
      } catch (err) {
        console.warn('[PaintCeremony] flyTo failed', err);
        // Fallback: still mount the bloom even if flyTo errored.
        setCameraSettled(true);
      }
    }, CAMERA_FLY_DELAY_MS);

    const completeTimeout = setTimeout(() => {
      startedRef.current = false;
      setCameraSettled(false);
      onComplete();
    }, CEREMONY_DURATION_MS);

    return () => {
      clearTimeout(flyTimeout);
      clearTimeout(completeTimeout);
    };
  }, [open, hueId, venue, map, onComplete]);

  if (!open || !hueId || !venue) return null;

  const hue = VIBE_HUES.find((h) => h.id === hueId);
  if (!hue) return null;

  const hueCSS = `hsl(${hue.degrees}, ${hue.defaultSat}%, 50%)`;
  const hueCSSBright = `hsl(${hue.degrees}, ${hue.defaultSat}%, 60%)`;
  const hueCSSAlpha = `hsla(${hue.degrees}, ${hue.defaultSat}%, 50%, 0.6)`;

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

          {/* Bloom only mounts after camera settles at venue */}
          {map && cameraSettled && (
            <VenueBloomOverlay
              map={map}
              venue={venue}
              hueCSS={hueCSS}
              hueCSSBright={hueCSSBright}
              hueCSSAlpha={hueCSSAlpha}
            />
          )}
        </>
      )}
    </AnimatePresence>
  );
}

// Bloom + thump rings, anchored to the venue's screen position.
// Tracks pan/zoom so it stays glued to the venue throughout the ceremony.
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
      } catch { /* not ready */ }
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
          duration: 2.6,
          delay: 0.4,
          times: [0, 0.2, 0.75, 1],
          ease: [0.22, 1, 0.36, 1], // custom expo-out
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

      {/* PERMANENCE ring — thin outer ring expands and fades, marking the act */}
      <motion.div
        initial={{ opacity: 0, scale: 0.1 }}
        animate={{
          opacity: [0, 0.5, 0],
          scale: [0.1, 1.0, 1.8],
        }}
        transition={{
          duration: 2.0,
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
