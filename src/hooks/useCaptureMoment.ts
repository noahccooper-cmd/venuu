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
    console.log('[capture] capturePhoto called, current status:', status);
    setStatus('capturing');
    setError(null);
    try {
      console.log('[capture] calling Camera.getPhoto...');
      const photo = await Camera.getPhoto({
        quality: 85,
        width: 1080,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        saveToGallery: false,
      });
      console.log('[capture] Camera.getPhoto returned, has dataUrl:', !!photo.dataUrl);
      if (!photo.dataUrl) {
        console.warn('[capture] photo missing dataUrl', photo);
        setStatus('error');
        setError('Photo capture failed');
        return;
      }
      setCapturedDataUrl(photo.dataUrl);
      setStatus('preview');
      console.log('[capture] preview state set, dataUrl length:', photo.dataUrl.length);
    } catch (err: any) {
      const msg = err?.message || '';
      console.warn('[capture] Camera.getPhoto THREW:', msg, err);

      // Cancellation — silent reset
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('user cancelled')) {
        console.log('[capture] treated as user cancellation, resetting to idle');
        setStatus('idle');
        return;
      }

      // Permission denial — surface to user with settings hint
      if (msg.toLowerCase().includes('denied') || msg.toLowerCase().includes('permission')) {
        setStatus('error');
        setError('camera_permission_denied');
        // Visible alert so user knows how to fix
        alert('Camera permission denied.\n\nGo to: Settings → venuu → Camera → Allow\n\nThen come back and tap CAPTURE YOUR MOMENT again.');
        return;
      }

      // Plugin not implemented — surface clearly
      if (msg.toLowerCase().includes('not implemented') || msg.toLowerCase().includes('plugin')) {
        setStatus('error');
        setError('camera_plugin_missing');
        alert('Camera plugin not loaded. Please force-quit and reopen venuu.');
        return;
      }

      // Generic camera failure — surface with the actual error
      setStatus('error');
      setError(msg || 'Camera unavailable');
      alert(`Camera failed: ${msg || 'Unknown error'}`);
    }
  }, [status]);

  const submitMoment = useCallback(async (
    venueId: string,
    username: string,
    hueDegrees: number,
  ): Promise<{ success: boolean; error?: string }> => {
    console.log('[capture] submitMoment called', { venueId, username, hueDegrees });
    if (!capturedDataUrl) {
      console.warn('[capture] submitMoment: no capturedDataUrl in state');
      return { success: false, error: 'No photo to submit' };
    }

    setStatus('uploading');
    setError(null);

    try {
      console.log('[capture] converting dataUrl to blob...');
      const fetchRes = await fetch(capturedDataUrl);
      const blob = await fetchRes.blob();
      console.log('[capture] blob ready, size:', blob.size);

      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) {
        console.warn('[capture] auth.getUser failed in submit', userErr);
        setStatus('error');
        setError('not_authenticated');
        return { success: false, error: 'not_authenticated' };
      }
      const userId = userRes.user.id;

      const filename = `${venueId}_${Date.now()}.jpg`;
      const path = `${userId}/${filename}`;
      console.log('[capture] uploading to recap-moments:', path);

      const { error: uploadErr } = await supabase.storage
        .from('recap-moments')
        .upload(path, blob, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: false,
        });
      if (uploadErr) {
        console.warn('[capture] storage upload failed:', uploadErr.message, uploadErr);
        setStatus('error');
        setError('photo_upload_failed');
        return { success: false, error: 'photo_upload_failed' };
      }
      console.log('[capture] upload succeeded');

      const { data: publicUrlData } = supabase.storage
        .from('recap-moments')
        .getPublicUrl(path);
      const photoUrl = publicUrlData.publicUrl;
      if (!photoUrl) {
        console.warn('[capture] could not get public URL');
        setStatus('error');
        setError('photo_upload_failed');
        return { success: false, error: 'photo_upload_failed' };
      }
      console.log('[capture] photoUrl:', photoUrl);

      setStatus('submitting');
      console.log('[capture] calling submit_moment RPC');
      const { error: rpcErr } = await supabase.rpc('submit_moment', {
        p_venue_id: venueId,
        p_username: username,
        p_photo_url: photoUrl,
        p_hue_at_capture: hueDegrees,
      });
      if (rpcErr) {
        console.warn('[capture] submit_moment RPC failed:', rpcErr.message, rpcErr);
        setStatus('error');
        const code = rpcErr.message || '';
        if (code.includes('already_crowned')) setError('already_crowned');
        else if (code.includes('guest_not_allowed')) setError('guest_not_allowed');
        else if (code.includes('not_authenticated')) setError('not_authenticated');
        else setError(code);
        return { success: false, error: code };
      }

      console.log('[capture] submit_moment succeeded');
      setStatus('success');
      return { success: true };
    } catch (err: any) {
      console.warn('[capture] submitMoment EXCEPTION', err);
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
