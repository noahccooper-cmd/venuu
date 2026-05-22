import { useState, useCallback } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { supabase } from '../lib/supabase';

export type CaptureStatus = 'idle' | 'capturing' | 'preview' | 'uploading' | 'submitting' | 'success' | 'error';

export interface UseCaptureMomentReturn {
  status: CaptureStatus;
  error: string | null;
  capturedDataUrl: string | null;
  capturePhoto: () => Promise<void>;
  submitMoment: (venueId: string, username: string, hueDegrees: number) => Promise<{ success: boolean; error?: string }>;
  reset: () => void;
}

/**
 * Wraps the full capture-and-submit sequence for a venuu moment:
 *   capturePhoto() opens the native camera, returns a base64 dataUrl
 *   submitMoment() uploads to recap-moments storage and calls submit_moment RPC
 *   reset() returns to idle (used when user backs out of preview)
 *
 * Errors are surfaced as friendly strings. The PROMPT 42 RPC raises
 * structured codes (already_crowned, guest_not_allowed, etc.) which
 * are translated here for UI display.
 */
export function useCaptureMoment(): UseCaptureMomentReturn {
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setCapturedDataUrl(null);
  }, []);

  const capturePhoto = useCallback(async () => {
    setStatus('capturing');
    setError(null);
    try {
      const photo = await Camera.getPhoto({
        quality: 85,
        width: 1080,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        saveToGallery: false,
      });
      if (!photo.dataUrl) {
        setStatus('error');
        setError('Photo capture failed');
        return;
      }
      setCapturedDataUrl(photo.dataUrl);
      setStatus('preview');
    } catch (err: any) {
      // User cancellation should reset cleanly, not show an error
      if (err?.message?.toLowerCase().includes('cancel') || err?.message?.toLowerCase().includes('user cancelled')) {
        setStatus('idle');
        return;
      }
      console.warn('[capture] camera failed:', err);
      setStatus('error');
      setError(err?.message || 'Camera unavailable');
    }
  }, []);

  const submitMoment = useCallback(async (
    venueId: string,
    username: string,
    hueDegrees: number,
  ): Promise<{ success: boolean; error?: string }> => {
    if (!capturedDataUrl) {
      return { success: false, error: 'No photo to submit' };
    }

    setStatus('uploading');
    setError(null);

    try {
      // 1. Convert data URL to Blob
      const fetchRes = await fetch(capturedDataUrl);
      const blob = await fetchRes.blob();

      // 2. Get user_id for path
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) {
        setStatus('error');
        setError('not_authenticated');
        return { success: false, error: 'not_authenticated' };
      }
      const userId = userRes.user.id;

      // 3. Upload to recap-moments bucket
      const filename = `${venueId}_${Date.now()}.jpg`;
      const path = `${userId}/${filename}`;
      const { error: uploadErr } = await supabase.storage
        .from('recap-moments')
        .upload(path, blob, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: false,
        });
      if (uploadErr) {
        setStatus('error');
        setError('photo_upload_failed');
        return { success: false, error: 'photo_upload_failed' };
      }

      // 4. Get public URL
      const { data: publicUrlData } = supabase.storage
        .from('recap-moments')
        .getPublicUrl(path);
      const photoUrl = publicUrlData.publicUrl;
      if (!photoUrl) {
        setStatus('error');
        setError('photo_upload_failed');
        return { success: false, error: 'photo_upload_failed' };
      }

      // 5. Call submit_moment RPC
      setStatus('submitting');
      const { error: rpcErr } = await supabase.rpc('submit_moment', {
        p_venue_id: venueId,
        p_username: username,
        p_photo_url: photoUrl,
        p_hue_at_capture: hueDegrees,
      });
      if (rpcErr) {
        setStatus('error');
        // Map RPC error codes to friendly messages
        const code = rpcErr.message || '';
        if (code.includes('already_crowned')) setError('already_crowned');
        else if (code.includes('guest_not_allowed')) setError('guest_not_allowed');
        else if (code.includes('not_authenticated')) setError('not_authenticated');
        else setError(code);
        return { success: false, error: code };
      }

      setStatus('success');
      return { success: true };
    } catch (err: any) {
      setStatus('error');
      setError(err?.message || 'Unknown error');
      return { success: false, error: err?.message };
    }
  }, [capturedDataUrl]);

  return {
    status, error, capturedDataUrl,
    capturePhoto, submitMoment, reset,
  };
}
