/**
 * WebRTC-based selfie capture for venuu moments.
 *
 * Streams the front-facing camera via getUserMedia, exposes the
 * stream for the CaptureSurface to render in a <video> element,
 * and captures a still frame to memory on shutter.
 *
 * Phase 1 scope (this hook): get stream, render, capture frame.
 * Phase 2 (49b): canvas composite + JPEG export.
 * Phase 3 (49c): submit pipeline integration.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export type CaptureStatus =
  | 'idle'              // before user does anything
  | 'requesting'        // getUserMedia in flight
  | 'streaming'         // stream live, ready to shoot
  | 'permission_denied' // user denied or iOS denied
  | 'unsupported'       // browser/device doesn't support WebRTC
  | 'captured'          // frame in memory
  | 'error';            // generic failure

export interface UseSelfieCaptureReturn {
  status: CaptureStatus;
  stream: MediaStream | null;
  capturedFrame: ImageBitmap | null;
  error: string | null;
  requestStream: () => Promise<void>;
  captureFrame: (videoEl: HTMLVideoElement) => Promise<void>;
  reset: () => void;
  stopStream: () => void;
}

export function useSelfieCapture(): UseSelfieCaptureReturn {
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedFrame, setCapturedFrame] = useState<ImageBitmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setStream(null);
    }
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setCapturedFrame(null);
    setError(null);
    stopStream();
  }, [stopStream]);

  const requestStream = useCallback(async () => {
    console.log('[selfie] requestStream called, current status:', status);
    setStatus('requesting');
    setError(null);

    // Capability check
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn('[selfie] mediaDevices.getUserMedia not available');
      setStatus('unsupported');
      setError('Camera API not available on this device');
      return;
    }

    try {
      console.log('[selfie] calling getUserMedia (front camera)...');
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width:  { ideal: 1080 },
          height: { ideal: 1920 },
        },
        audio: false,
      });
      console.log('[selfie] getUserMedia returned, tracks:', mediaStream.getTracks().length);
      streamRef.current = mediaStream;
      setStream(mediaStream);
      setStatus('streaming');
    } catch (err: any) {
      const msg = err?.message || err?.name || 'Unknown camera error';
      console.warn('[selfie] getUserMedia THREW:', msg, err);
      if (
        msg.toLowerCase().includes('denied') ||
        msg.toLowerCase().includes('permission') ||
        err?.name === 'NotAllowedError'
      ) {
        setStatus('permission_denied');
        setError('Camera permission denied');
        return;
      }
      if (err?.name === 'NotFoundError' || msg.toLowerCase().includes('not found')) {
        setStatus('unsupported');
        setError('No camera found on this device');
        return;
      }
      setStatus('error');
      setError(msg);
    }
  }, [status]);

  const captureFrame = useCallback(async (videoEl: HTMLVideoElement) => {
    if (!videoEl || status !== 'streaming') {
      console.warn('[selfie] captureFrame called with invalid state', {
        hasVideo: !!videoEl, status,
      });
      return;
    }
    console.log('[selfie] capturing frame from video element...');
    try {
      // createImageBitmap is the fastest path — captures the current
      // video frame as a bitmap that we can later composite onto a
      // canvas (Phase 2: 49b) or display directly.
      const bitmap = await createImageBitmap(videoEl);
      console.log('[selfie] frame captured, dimensions:', bitmap.width, 'x', bitmap.height);
      setCapturedFrame(bitmap);
      setStatus('captured');
    } catch (err: any) {
      console.warn('[selfie] captureFrame failed:', err);
      setStatus('error');
      setError(err?.message || 'Frame capture failed');
    }
  }, [status]);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  return {
    status, stream, capturedFrame, error,
    requestStream, captureFrame, reset, stopStream,
  };
}
