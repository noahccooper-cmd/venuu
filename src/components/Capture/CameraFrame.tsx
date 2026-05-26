import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import PolaroidHeader from './PolaroidHeader';

interface CameraFrameProps {
  stream: MediaStream | null;
  hueDegrees: number;
  hueLightness: number;
  /** Captured frame to display (when in 'captured' state) */
  capturedFrame: ImageBitmap | null;
  /** Brief flash overlay during shutter */
  showFlash: boolean;
  // NEW — Polaroid header props now live inside the frame
  venueName: string;
  headerTriggerKey: number;
  // NEW — true during the brief warmup before stream is rendering
  warming: boolean;
}

export interface CameraFrameHandle {
  getVideoElement: () => HTMLVideoElement | null;
}

/**
 * The live viewfinder with hue-tinted frame + halo + bleed-in tint.
 *
 * - Live mode: <video> element shows the WebRTC stream
 * - Captured mode: canvas with the still frame rendered
 * - The frame border + halo + 5% photo bleed all tint to active hue
 */
const CameraFrame = forwardRef<CameraFrameHandle, CameraFrameProps>(({
  stream, hueDegrees, hueLightness, capturedFrame, showFlash,
  venueName, headerTriggerKey, warming,
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current,
  }), []);

  // Wire stream to video element
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Render captured frame to canvas when state changes
  useEffect(() => {
    if (capturedFrame && canvasRef.current) {
      const c = canvasRef.current;
      c.width = capturedFrame.width;
      c.height = capturedFrame.height;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.drawImage(capturedFrame, 0, 0);
      }
    }
  }, [capturedFrame]);

  const hueColor    = `hsl(${hueDegrees}, 80%, ${hueLightness}%)`;
  const hueGlowEdge = `hsla(${hueDegrees}, 90%, ${Math.min(80, hueLightness + 10)}%, 0.55)`;
  const hueGlowOut  = `hsla(${hueDegrees}, 90%, ${Math.min(80, hueLightness + 10)}%, 0.15)`;
  const hueBleed    = `hsla(${hueDegrees}, 70%, ${hueLightness}%, 0.05)`;
  // ^^ 5% bleed — extremely subtle, per locked decision

  return (
    <div
      style={{
        position: 'relative',
        width: '78%',
        maxWidth: '380px',
        aspectRatio: '9/16',
        borderRadius: '24px',
        overflow: 'hidden',
        border: `3px solid ${hueColor}`,
        boxShadow: `
          0 0 28px ${hueGlowEdge},
          0 0 60px ${hueGlowOut},
          inset 0 0 0 1px rgba(255,255,255,0.04)
        `,
        background: '#000',
        transition: 'border-color 0.18s ease, box-shadow 0.25s ease',
      }}
    >
      {/* Live stream */}
      {!capturedFrame && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%',
            height: '100%',
            // 'contain' shows the full sensor capture letterboxed instead
            // of cropping to fill. Combined with the wider sensor request,
            // this gives the .5x ultrawide selfie effect — you see your
            // face AND the environment around you.
            objectFit: 'contain',
            // Mirror horizontally so it feels like a mirror not a camera
            // The scale 0.85 zooms slightly OUT (smaller image in frame),
            // creating the wide-angle perception. Adjust 0.7-0.95 to taste.
            transform: 'scaleX(-1) scale(0.85)',
            transformOrigin: 'center center',
            display: 'block',
            background: '#000',  // letterbox bars are pure black
          }}
        />
      )}

      {/* Captured frame */}
      {capturedFrame && (
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            transform: 'scaleX(-1) scale(0.85)',
            transformOrigin: 'center center',
            display: 'block',
            background: '#000',
          }}
        />
      )}

      {/* Subtle gradient behind header — readability in bright lighting */}
      <div
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          height: '28%',
          background: 'linear-gradient(180deg, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0.16) 35%, transparent 100%)',
          pointerEvents: 'none',
          zIndex: 2,
        }}
      />

      {/* Polaroid header — engraved into the photo, top-left */}
      <div
        style={{
          position: 'absolute',
          top: '18px',
          left: '18px',
          zIndex: 3,
          pointerEvents: 'none',
        }}
      >
        <PolaroidHeader
          venueName={venueName}
          hueDegrees={hueDegrees}
          hueLightness={hueLightness}
          triggerKey={headerTriggerKey}
        />
      </div>

      {/* Subtle 5% hue bleed overlay — the venuu touch */}
      <div
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `radial-gradient(circle at center,
            transparent 40%,
            ${hueBleed} 100%)`,
          transition: 'background 0.2s ease',
        }}
      />

      {/* Film grain (very subtle — adds Polaroid feel) */}
      <div
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          opacity: 0.04,
          mixBlendMode: 'overlay',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Warming up — single shimmer sweep when stream first opens */}
      {warming && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            overflow: 'hidden',
            zIndex: 4,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0, right: 0, height: '120px',
              top: '-120px',
              background: `linear-gradient(180deg,
                transparent 0%,
                hsla(${hueDegrees}, 90%, ${Math.min(80, hueLightness + 15)}%, 0.18) 50%,
                transparent 100%)`,
              animation: 'capture-warmup-sweep 700ms ease-out forwards',
            }}
          />
        </div>
      )}

      {/* Shutter flash */}
      {showFlash && (
        <div
          style={{
            position: 'absolute', inset: 0,
            background: 'white',
            opacity: 0,
            animation: 'shutter-flash 400ms ease-out forwards',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
});

CameraFrame.displayName = 'CameraFrame';

export default CameraFrame;
