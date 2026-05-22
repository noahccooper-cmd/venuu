import { motion, AnimatePresence } from 'framer-motion';
import { useCaptureMoment } from '../../hooks/useCaptureMoment';
import type { VibeHue } from '../../lib/hueMath';

interface CaptureModuleProps {
  landedHue: VibeHue | null;
  onPhotoReady: (hue: VibeHue, capture: ReturnType<typeof useCaptureMoment>) => void;
  onClear: () => void;
  capture: ReturnType<typeof useCaptureMoment>;
}

/**
 * The capture section that appears inside PaintScreen below the hue
 * slider. Two states:
 *   - No photo yet → "Capture your moment" button + "just paint" link
 *   - Photo captured → thumbnail preview with hue-tinted frame border,
 *     "retake or skip" inline option (skip = clear photo, paint only)
 */
export default function CaptureModule({ landedHue, onPhotoReady, onClear, capture }: CaptureModuleProps) {
  const { status, capturedDataUrl, capturePhoto } = capture;

  // Don't show capture UI until user has landed on a hue
  if (!landedHue) return null;

  const isCapturing = status === 'capturing';
  const hasPhoto = status === 'preview' || (status === 'success' && capturedDataUrl);

  const hueBorder = `hsl(${landedHue.degrees}, ${landedHue.defaultSat}%, 55%)`;
  const hueGlow = `hsla(${landedHue.degrees}, ${landedHue.defaultSat}%, 60%, 0.5)`;

  const handleCapture = async () => {
    await capturePhoto();
    onPhotoReady(landedHue, capture);
  };

  return (
    <AnimatePresence mode="wait">
      {!hasPhoto ? (
        <motion.div
          key="capture-cta"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            marginTop: '24px',
          }}
        >
          <button
            onClick={handleCapture}
            disabled={isCapturing}
            style={{
              width: '100%',
              maxWidth: '320px',
              padding: '14px 24px',
              background: 'rgba(255,255,255,0.05)',
              border: `1.5px solid ${hueBorder}`,
              borderRadius: '14px',
              color: '#fff',
              fontFamily: 'Satoshi, sans-serif',
              fontSize: '14px',
              fontWeight: 700,
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              cursor: 'pointer',
              boxShadow: `0 0 18px ${hueGlow}`,
              transition: 'all 0.2s',
            }}
          >
            {isCapturing ? 'opening camera…' : '✦ capture your moment'}
          </button>
          <button
            onClick={onClear}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.4)',
              fontFamily: 'Satoshi, sans-serif',
              fontSize: '11px',
              fontWeight: 500,
              letterSpacing: '0.5px',
              textTransform: 'lowercase',
              cursor: 'pointer',
              padding: '4px 8px',
              marginTop: '2px',
            }}
          >
            or just paint, no photo
          </button>
        </motion.div>
      ) : (
        <motion.div
          key="capture-confirmed"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px',
            marginTop: '24px',
          }}
        >
          {/* Confirmation card — hue-tinted, no photo visible */}
          <div
            style={{
              width: '100%',
              maxWidth: '320px',
              padding: '20px 18px',
              borderRadius: '16px',
              border: `1.5px solid ${hueBorder}`,
              background: `linear-gradient(135deg,
                hsla(${landedHue.degrees}, ${landedHue.defaultSat}%, 50%, 0.08),
                hsla(${landedHue.degrees}, ${landedHue.defaultSat}%, 30%, 0.04))`,
              boxShadow: `0 0 28px ${hueGlow}, inset 0 0 0 1px rgba(255,255,255,0.04)`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {/* Mark — abstract symbol, not a photo. The hue carries the meaning. */}
            <div
              style={{
                width: '52px',
                height: '52px',
                borderRadius: '50%',
                border: `2px solid ${hueBorder}`,
                background: `radial-gradient(circle,
                  hsla(${landedHue.degrees}, 90%, 65%, 0.4) 0%,
                  hsla(${landedHue.degrees}, 80%, 55%, 0.1) 70%,
                  transparent 100%)`,
                boxShadow: `0 0 20px ${hueGlow}, inset 0 0 12px hsla(${landedHue.degrees}, 90%, 60%, 0.25)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '20px',
                color: hueBorder,
              }}
            >
              {'✦'}
            </div>

            <div
              style={{
                fontSize: '14px',
                fontWeight: 800,
                color: '#fff',
                fontFamily: 'Satoshi, sans-serif',
                letterSpacing: '2px',
                textTransform: 'uppercase',
                textAlign: 'center',
                marginTop: '4px',
              }}
            >
              moment captured
            </div>

            <div
              style={{
                fontSize: '11px',
                color: 'rgba(255,255,255,0.55)',
                fontFamily: 'Satoshi, sans-serif',
                letterSpacing: '1px',
                textTransform: 'uppercase',
                textAlign: 'center',
              }}
            >
              develops at 8am tomorrow
            </div>

            <div
              style={{
                fontSize: '10px',
                color: 'rgba(255,255,255,0.3)',
                fontFamily: 'Satoshi, sans-serif',
                letterSpacing: '0.5px',
                textAlign: 'center',
                marginTop: '4px',
                fontStyle: 'italic',
              }}
            >
              you'll see it in the morning
            </div>
          </div>

          {/* Escape link — clear photo, paint without moment */}
          <button
            onClick={onClear}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.35)',
              fontFamily: 'Satoshi, sans-serif',
              fontSize: '11px',
              fontWeight: 500,
              letterSpacing: '0.5px',
              textTransform: 'lowercase',
              cursor: 'pointer',
              padding: '4px 8px',
              marginTop: '2px',
            }}
          >
            clear capture, paint only
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
