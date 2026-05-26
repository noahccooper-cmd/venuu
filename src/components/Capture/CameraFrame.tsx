import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import PolaroidHeader from './PolaroidHeader';
import MomentNumber from './MomentNumber';

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
  // NEW — mythological number
  momentNumber: number;
  showNumberReveal: boolean;
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
  momentNumber, showNumberReveal,
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
  // Hue bloom is now expressed inline (edges-in, screen blend) rather
  // than via a single precomputed bleed color — see the bloom overlay below.

  return (
    <div
      style={{
        position: 'relative',
        width: '72%',
        maxWidth: '320px',
        aspectRatio: '9/16',
        borderRadius: '24px',
        overflow: 'hidden',
        border: `3px solid ${hueColor}`,
        boxShadow: `
          0 0 0 1px rgba(255,255,255,0.03),
          0 0 14px ${hueGlowEdge},
          0 0 36px ${hueGlowOut},
          0 0 72px ${hueGlowOut},
          inset 0 0 14px ${hueGlowEdge}
        `,
        background: '#000',
        transition: 'border-color 0.18s ease, box-shadow 0.25s ease',
      }}
    >
      {/* Slow breathing glow — frame is alive */}
      <div
        style={{
          position: 'absolute',
          inset: '-1px',
          borderRadius: '24px',
          pointerEvents: 'none',
          boxShadow: `0 0 32px ${hueGlowEdge}`,
          animation: 'frame-breath 6s ease-in-out infinite',
          zIndex: 0,
        }}
      />

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

      {/* Gradient + header are now grouped in a single container that
          sits INSIDE the frame's rounded interior, never clipping
          against the border. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          paddingTop: '22px',
          paddingLeft: '22px',
          paddingRight: '22px',
          paddingBottom: '32px',
          background: 'linear-gradient(180deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.22) 50%, transparent 100%)',
          pointerEvents: 'none',
          zIndex: 3,
          borderTopLeftRadius: '20px',   // matches frame radius (24px) minus border (4px)
          borderTopRightRadius: '20px',
        }}
      >
        <PolaroidHeader
          venueName={venueName}
          hueDegrees={hueDegrees}
          hueLightness={hueLightness}
          triggerKey={headerTriggerKey}
        />
      </div>

      {/* MOMENT NUMBER — mythological identity in the bottom-right.
          Mirror position to the top-left Polaroid header. Every venuu
          user gets this. The luxury IS having a number at all. */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          paddingBottom: '18px',
          paddingRight: '22px',
          paddingTop: '24px',
          paddingLeft: '40px',
          background: 'linear-gradient(0deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.22) 50%, transparent 100%)',
          pointerEvents: 'none',
          zIndex: 3,
          borderBottomLeftRadius: '20px',
          borderBottomRightRadius: '20px',
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        <MomentNumber
          momentNumber={momentNumber}
          hueDegrees={hueDegrees}
          hueLightness={hueLightness}
          revealed={showNumberReveal}
        />
      </div>

      {/* Hue bloom — light leaking from frame edges INWARD into photo */}
      <div
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `
            radial-gradient(ellipse at center,
              transparent 35%,
              hsla(${hueDegrees}, 80%, ${hueLightness}%, 0.10) 100%),
            linear-gradient(180deg,
              hsla(${hueDegrees}, 80%, ${hueLightness}%, 0.08) 0%,
              transparent 25%,
              transparent 75%,
              hsla(${hueDegrees}, 80%, ${hueLightness}%, 0.08) 100%)
          `,
          mixBlendMode: 'screen',
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

      {/* Warming up — luxurious hue sweep when surface first opens */}
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
              left: 0, right: 0,
              height: '220px',
              top: '-220px',
              background: `linear-gradient(180deg,
                transparent 0%,
                hsla(${hueDegrees}, 90%, ${Math.min(80, hueLightness + 15)}%, 0.10) 30%,
                hsla(${hueDegrees}, 95%, ${Math.min(80, hueLightness + 18)}%, 0.32) 55%,
                hsla(${hueDegrees}, 90%, ${Math.min(80, hueLightness + 15)}%, 0.10) 80%,
                transparent 100%)`,
              animation: 'capture-warmup-sweep 950ms cubic-bezier(0.4, 0, 0.2, 1) forwards',
              mixBlendMode: 'screen',
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
