import { motion, AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';

interface MomentFullScreenProps {
  open: boolean;
  moment: {
    id: string;
    venue_id: string;
    venue_name: string;
    photo_url: string;
    hue_at_capture: number;
    developed_at: string;
    created_at: string;
    username?: string;
  } | null;
  onClose: () => void;
}

/**
 * Full-screen presentation of a captured moment. Photo center,
 * hue frame + glow, venue name + date + username in editorial
 * type at bottom. Tap anywhere to dismiss.
 *
 * Locked state: same layout but photo is frosted and "Develops
 * at 8am" overlays the center. Still tappable to dismiss.
 */
export default function MomentFullScreen({ open, moment, onClose }: MomentFullScreenProps) {
  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!moment) return null;

  const isDeveloped = new Date(moment.developed_at).getTime() <= Date.now();
  const hue = moment.hue_at_capture;
  const hueBorder = `hsl(${hue}, 70%, 55%)`;
  const hueGlow = `hsla(${hue}, 80%, 60%, 0.55)`;

  const dateStr = new Date(moment.created_at).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9000,
            background: 'rgba(0,0,0,0.92)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '32px',
          }}
        >
          <motion.div
            initial={{ scale: 0.92 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.95 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '420px',
              aspectRatio: '3 / 4',
              borderRadius: '20px',
              overflow: 'hidden',
              border: `4px solid ${hueBorder}`,
              boxShadow: `0 0 60px ${hueGlow}, 0 8px 40px rgba(0,0,0,0.6)`,
              position: 'relative',
              background: '#0a0a0a',
            }}
          >
            {moment.photo_url && (
              <img
                src={moment.photo_url}
                alt=""
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: 'block',
                  filter: isDeveloped ? 'none' : 'blur(20px) brightness(0.5)',
                }}
              />
            )}

            {/* Locked overlay if not developed */}
            {!isDeveloped && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'rgba(255,255,255,0.95)',
                  fontFamily: 'Satoshi, sans-serif',
                  gap: '8px',
                }}
              >
                <div style={{
                  fontSize: '11px',
                  letterSpacing: '2px',
                  textTransform: 'uppercase',
                  opacity: 0.6,
                }}>
                  developing
                </div>
                <div style={{
                  fontSize: '32px',
                  fontWeight: 700,
                  letterSpacing: '2px',
                }}>
                  8 AM
                </div>
                <div style={{
                  fontSize: '10px',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  opacity: 0.4,
                  marginTop: '4px',
                }}>
                  tomorrow
                </div>
              </div>
            )}

            {/* Hue gradient at the bottom — engraved metadata bar */}
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                padding: '20px 18px 16px',
                background: `linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.7) 60%, rgba(0,0,0,0.92) 100%)`,
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
              }}
            >
              <div style={{
                color: '#fff',
                fontFamily: 'Satoshi, sans-serif',
                fontSize: '18px',
                fontWeight: 800,
                letterSpacing: '0.5px',
                textShadow: '0 1px 6px rgba(0,0,0,0.5)',
              }}>
                {moment.venue_name}
              </div>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '2px',
              }}>
                <div style={{
                  color: 'rgba(255,255,255,0.65)',
                  fontFamily: 'Satoshi, sans-serif',
                  fontSize: '11px',
                  fontWeight: 500,
                  letterSpacing: '1.5px',
                  textTransform: 'uppercase',
                }}>
                  {dateStr}
                </div>
                {moment.username && (
                  <div style={{
                    color: hueBorder,
                    fontFamily: 'Satoshi, sans-serif',
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '0.5px',
                  }}>
                    @{moment.username}
                  </div>
                )}
              </div>
            </div>
          </motion.div>

          {/* Tap-anywhere-to-close hint */}
          <div style={{
            position: 'absolute',
            bottom: '20px',
            left: 0,
            right: 0,
            textAlign: 'center',
            color: 'rgba(255,255,255,0.25)',
            fontFamily: 'Satoshi, sans-serif',
            fontSize: '10px',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            pointerEvents: 'none',
          }}>
            tap anywhere to close
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
