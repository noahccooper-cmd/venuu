// src/components/Paint/PaintCeremony.tsx
//
// Phase D: the 2.4s sacred sequence after a user taps "paint".
//
// Soul Doc compliance:
//   "Your chosen hue needs to be a STATEMENT on the map and that area
//    before fading into the grid."
//
// Timeline:
//   0.0–0.3s : PaintScreen fades to black (handled by PaintScreen's exit anim)
//   0.3–0.6s : Map visible, camera flies to venue (zoom 16, pitch 45°)
//   0.6–1.4s : THE STATEMENT — massive radial bloom of user's hue
//              radiates outward from venue screen position, peaks at
//              95% opacity. The area is THEIRS for 800ms.
//   1.4–2.0s : Settle — bloom scales up and fades out. The user's
//              stroke is now part of the aggregate (vibe_ratings INSERT
//              already fired in PaintScreen → realtime sub will
//              update the venue's bubble hue on next data tick).
//   2.0–2.4s : Return to normal map state.
//
// This component is a controller, not a renderer of the bubble itself.
// The bubble's permanent hue shift is handled by:
//   - vibe_ratings INSERT (PaintScreen)
//   - get_venue_current_hue() recompute (server-side, immediate)
//   - LiveVenueBubble re-reading vibe_hue_baseline + current_hue
//
// What this component renders: a single radial overlay that tracks
// the venue's screen position across the 2.4s sequence.
//
// Props:
//   open, hueId, venue (with coords), map (mapbox-gl ref), onComplete

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

const CEREMONY_DURATION_MS = 2400;
const CAMERA_FLY_DELAY_MS = 300;
const CAMERA_FLY_DURATION_MS = 700;
const BLOOM_DELAY_MS = 700;

export default function PaintCeremony({
  open,
  hueId,
  venue,
  map,
  onComplete,
}: PaintCeremonyProps) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (!open || !hueId || !venue || !map || startedRef.current) return;
    startedRef.current = true;

    // Phase 1: camera fly (300ms in)
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
      } catch (err) {
        console.warn('[PaintCeremony] flyTo failed', err);
      }
    }, CAMERA_FLY_DELAY_MS);

    // Phase 2: complete handoff
    const completeTimeout = setTimeout(() => {
      startedRef.current = false;
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
  const hueCSSAlpha = `hsla(${hue.degrees}, ${hue.defaultSat}%, 50%, 0.5)`;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Black-out overlay — fades out as camera flies in. */}
          <motion.div
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
            className="fixed inset-0 z-[8500] bg-black pointer-events-none"
          />

          {/* The STATEMENT — radial bloom at venue screen position.
              Only renders when map is available; the black-fade overlay
              and the 2.4s timer still run without it (handles null map
              gracefully). */}
          {map && (
            <VenueBloomOverlay
              map={map}
              venue={venue}
              hueCSS={hueCSS}
              hueCSSAlpha={hueCSSAlpha}
            />
          )}
        </>
      )}
    </AnimatePresence>
  );
}

// Sub-component: tracks the venue's screen position as the map
// projection changes (during flyTo), and renders the bloom there.
function VenueBloomOverlay({
  map,
  venue,
  hueCSS,
  hueCSSAlpha,
}: {
  map: MapboxMap;
  venue: { lat: number; lng: number };
  hueCSS: string;
  hueCSSAlpha: string;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!map) return;

    const update = () => {
      try {
        const p = map.project([venue.lng, venue.lat]);
        setPos({ x: p.x, y: p.y });
      } catch {
        /* map not ready yet */
      }
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
      initial={{ opacity: 0, scale: 0.2 }}
      animate={{
        opacity: [0, 0.95, 0.95, 0],
        scale: [0.2, 1.0, 1.4, 1.6],
      }}
      transition={{
        duration: 1.7,
        delay: BLOOM_DELAY_MS / 1000,
        times: [0, 0.4, 0.7, 1],
        ease: 'easeOut',
      }}
      className="fixed pointer-events-none z-[8400]"
      style={{
        left: pos.x,
        top: pos.y,
        width: 600,
        height: 600,
        transform: 'translate(-50%, -50%)',
        background: `radial-gradient(circle, ${hueCSS} 0%, ${hueCSSAlpha} 30%, transparent 70%)`,
        filter: 'blur(20px)',
        mixBlendMode: 'screen',
      }}
    />
  );
}
