/**
 * WebRTC-based selfie capture for venuu moments.
 *
 * Streams the front-facing camera via getUserMedia, exposes the
 * stream for the CaptureSurface to render in a <video> element,
 * captures a still frame to memory on shutter, and composites
 * the engraved JPEG ready for upload.
 *
 * Phase 1 scope: get stream, render, capture frame. ✓
 * Phase 2 (49b): canvas composite + JPEG export. ✓ (this file)
 * Phase 3 (49c): submit pipeline integration.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { composeMomentJPEG } from '../lib/momentComposite';

export type CaptureStatus =
  | 'idle'              // before user does anything
  | 'requesting'        // getUserMedia in flight
  | 'streaming'         // stream live, ready to shoot
  | 'permission_denied' // user denied or iOS denied
  | 'unsupported'       // browser/device doesn't support WebRTC
  | 'captured'          // frame in memory
  | 'composing'         // composing the JPEG
  | 'composed'          // JPEG ready in state
  | 'error';            // generic failure

export interface UseSelfieCaptureReturn {
  status: CaptureStatus;
  stream: MediaStream | null;
  capturedFrame: ImageBitmap | null;
  /** The composed JPEG ready for upload (49b output) */
  composedBlob: Blob | null;
  /** Preview URL of the composite for in-screen verification (49b only) */
  composedPreviewURL: string | null;
  error: string | null;
  requestStream: () => Promise<void>;
  captureFrame: (videoEl: HTMLVideoElement) => Promise<void>;
  /** Compose the JPEG once we have a captured frame + metadata */
  compose: (opts: {
    hueDegrees: number;
    hueLightness: number;
    venueName: string;
    momentNumber: number;
  }) => Promise<void>;
  reset: () => void;
  stopStream: () => void;
}

export function useSelfieCapture(): UseSelfieCaptureReturn {
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedFrame, setCapturedFrame] = useState<ImageBitmap | null>(null);
  const [composedBlob, setComposedBlob] = useState<Blob | null>(null);
  const [composedPreviewURL, setComposedPreviewURL] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  // Mirror of the captured-frame state so the compose callback can
  // read it synchronously after captureFrame() resolves — without
  // this ref, compose() would see the stale (null) closed-over value
  // because React state updates from captureFrame are still batched
  // when handleShutter continues to its await selfie.compose(...) call.
  const capturedFrameRef = useRef<ImageBitmap | null>(null);
  // Mirror of the composedPreviewURL so reset can revoke the latest
  // URL without needing the value as a useCallback dep.
  const composedPreviewURLRef = useRef<string | null>(null);

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
    capturedFrameRef.current = null;
    setError(null);
    // Revoke previous preview URL to free memory
    if (composedPreviewURLRef.current) {
      URL.revokeObjectURL(composedPreviewURLRef.current);
      composedPreviewURLRef.current = null;
    }
    setComposedBlob(null);
    setComposedPreviewURL(null);
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
          // Request wider FOV. iOS Safari respects aspectRatio hints
          // when available, falling back gracefully to standard lens.
          aspectRatio: { ideal: 16/9 },
          width:  { ideal: 1920 },
          height: { ideal: 1080 },
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
      // Sync to ref AND state so compose() can read it immediately
      // via the ref without waiting for a re-render.
      capturedFrameRef.current = bitmap;
      setCapturedFrame(bitmap);
      setStatus('captured');
    } catch (err: any) {
      console.warn('[selfie] captureFrame failed:', err);
      setStatus('error');
      setError(err?.message || 'Frame capture failed');
    }
  }, [status]);

  const compose = useCallback(async (opts: {
    hueDegrees: number;
    hueLightness: number;
    venueName: string;
    momentNumber: number;
  }) => {
    // Read from ref, not state, so we see the bitmap immediately after
    // captureFrame() resolved — even before React has re-rendered.
    const frame = capturedFrameRef.current;
    if (!frame) {
      console.warn('[selfie] compose called without a captured frame');
      return;
    }
    setStatus('composing');
    try {
      const blob = await composeMomentJPEG({
        frame,
        hueDegrees: opts.hueDegrees,
        hueLightness: opts.hueLightness,
        venueName: opts.venueName,
        momentNumber: opts.momentNumber,
      });
      // Revoke the previous URL (if any) before creating a new one.
      if (composedPreviewURLRef.current) {
        URL.revokeObjectURL(composedPreviewURLRef.current);
      }
      const url = URL.createObjectURL(blob);
      composedPreviewURLRef.current = url;
      setComposedBlob(blob);
      setComposedPreviewURL(url);
      setStatus('composed');
      console.log('[selfie] composite ready, blob size:', blob.size);
    } catch (err: any) {
      console.warn('[selfie] composite failed:', err);
      setStatus('error');
      setError(err?.message || 'Composite failed');
    }
  }, []);

  // Cleanup stream + URL on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      if (composedPreviewURLRef.current) {
        URL.revokeObjectURL(composedPreviewURLRef.current);
      }
    };
  }, []);

  return {
    status, stream, capturedFrame, error,
    composedBlob, composedPreviewURL,
    requestStream, captureFrame, compose, reset, stopStream,
  };
}
