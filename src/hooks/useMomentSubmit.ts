/**
 * The full MARK pipeline as a self-contained hook.
 *
 * Flow when submit() is called:
 *   1. Upload composed JPEG to recap-moments storage (upsert: false)
 *   2. Call submit_moment RPC, read returned row including
 *      user_moment_number
 *   3. If number !== placeholder (1), recompose JPEG with real
 *      number, re-upload to SAME path (upsert: true)
 *   4. Call record_paint with hueId snapped to bucket, null prompt
 *   5. Resolve with { recapId, momentNumber, hueId }
 *
 * All states surface for the UI to render progress.
 *
 * The legacy useCaptureMoment.ts uses a similar pattern but for
 * the old Capacitor Camera flow. This hook is purpose-built for
 * the new WebRTC composite Blob path.
 */

import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { VIBE_HUES } from '../lib/hueMath';
import { composeMomentJPEG } from '../lib/momentComposite';
import { scheduleMomentDevelopNotification } from '../lib/scheduleMomentDevelopNotification';

export type SubmitStatus =
  | 'idle'
  | 'uploading'
  | 'submitting'
  | 'recomposing'
  | 'reuploading'
  | 'recording_paint'
  | 'success'
  | 'error';

export type SubmitErrorCode =
  | 'already_crowned'
  | 'guest_not_allowed'
  | 'not_authenticated'
  | 'photo_required'
  | 'invalid_hue'
  | 'upload_failed'
  | 'network'
  | 'unknown';

export interface SubmitOptions {
  blob: Blob;
  /** The captured ImageBitmap, needed if recompose is required */
  capturedFrame: ImageBitmap;
  venueId: string;
  venueName: string;
  username: string;
  hueDegrees: number;
  hueLightness: number;
}

export interface SubmitResult {
  recapId: string;
  momentNumber: number;
  hueId: number;
}

/**
 * Snap hueDegrees to the nearest VIBE_HUES bucket id.
 * Used for record_paint which expects an integer hue_id.
 */
function snapToHueBucket(degrees: number): number {
  let best = VIBE_HUES[0];
  let bestDist = 999;
  for (const h of VIBE_HUES) {
    const raw = Math.abs(h.degrees - degrees);
    const dist = Math.min(raw, 360 - raw);
    if (dist < bestDist) {
      bestDist = dist;
      best = h;
    }
  }
  return best.id;
}

export interface UseMomentSubmitReturn {
  status: SubmitStatus;
  error: string | null;
  errorCode: SubmitErrorCode | null;
  result: SubmitResult | null;
  submit: (opts: SubmitOptions) => Promise<SubmitResult | null>;
  reset: () => void;
}

export function useMomentSubmit(): UseMomentSubmitReturn {
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<SubmitErrorCode | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setErrorCode(null);
    setResult(null);
  }, []);

  const submit = useCallback(async (opts: SubmitOptions): Promise<SubmitResult | null> => {
    const {
      blob, capturedFrame, venueId, venueName, username,
      hueDegrees, hueLightness,
    } = opts;

    console.log('[momentSubmit] starting pipeline for', venueName);
    setStatus('uploading');
    setError(null);
    setErrorCode(null);

    try {
      // ── Step 1: Get authenticated user (auth.uid()) ───────
      const { data: userRes, error: authErr } = await supabase.auth.getUser();
      if (authErr || !userRes?.user) {
        setStatus('error');
        setErrorCode('not_authenticated');
        setError('Session expired. Please sign in again.');
        return null;
      }
      const userId = userRes.user.id;

      // ── Step 2: Upload JPEG to recap-moments storage ──────
      const filename = `${venueId}_${Date.now()}.jpg`;
      const path = `${userId}/${filename}`;
      console.log('[momentSubmit] uploading to', path);

      const { error: uploadErr } = await supabase
        .storage
        .from('recap-moments')
        .upload(path, blob, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadErr) {
        console.warn('[momentSubmit] upload failed:', uploadErr);
        setStatus('error');
        setErrorCode('upload_failed');
        setError(uploadErr.message || 'Upload failed');
        return null;
      }

      // ── Step 3: Resolve public URL ────────────────────────
      const { data: publicUrlData } = supabase
        .storage
        .from('recap-moments')
        .getPublicUrl(path);
      const photoUrl = publicUrlData.publicUrl;
      console.log('[momentSubmit] public URL:', photoUrl);

      // ── Step 4: Call submit_moment RPC ────────────────────
      setStatus('submitting');
      const { data: rpcData, error: rpcErr } = await supabase.rpc('submit_moment', {
        p_venue_id: venueId,
        p_username: username,
        p_photo_url: photoUrl,
        p_hue_at_capture: hueDegrees,
      });

      if (rpcErr) {
        const code = (rpcErr.message || '').toLowerCase();
        console.warn('[momentSubmit] RPC failed:', rpcErr);
        setStatus('error');
        if (code.includes('already_crowned')) {
          setErrorCode('already_crowned');
          setError('You\'ve already captured this venue.');
        } else if (code.includes('guest_not_allowed')) {
          setErrorCode('guest_not_allowed');
          setError('Please sign in to capture moments.');
        } else if (code.includes('not_authenticated')) {
          setErrorCode('not_authenticated');
          setError('Session expired. Please sign in again.');
        } else if (code.includes('photo_required')) {
          setErrorCode('photo_required');
          setError('Photo upload failed. Please retake.');
        } else if (code.includes('invalid_hue')) {
          setErrorCode('invalid_hue');
          setError('Invalid hue selection.');
        } else {
          setErrorCode('unknown');
          setError(rpcErr.message || 'Submit failed');
        }
        return null;
      }

      // RPC returns public.venue_recaps. PostgREST unwraps it
      // so rpcData is the row directly (not an array).
      const recapRow = rpcData as any;
      if (!recapRow || !recapRow.id) {
        console.warn('[momentSubmit] RPC returned no row:', rpcData);
        setStatus('error');
        setErrorCode('unknown');
        setError('Submit succeeded but no recap returned.');
        return null;
      }

      const recapId = recapRow.id as string;
      const momentNumber = recapRow.user_moment_number as number;
      const developedAt = recapRow.developed_at as string;
      console.log('[momentSubmit] recap created, moment number:', momentNumber, 'develops:', developedAt);

      // ── Step 5: Recompose with REAL moment number if !== 1 ─
      if (momentNumber !== 1) {
        console.log('[momentSubmit] recomposing with real number:', momentNumber);
        setStatus('recomposing');

        let realBlob: Blob | null = null;
        try {
          realBlob = await composeMomentJPEG({
            frame: capturedFrame,
            hueDegrees,
            hueLightness,
            venueName,
            momentNumber,
          });
        } catch (composeErr: any) {
          console.warn('[momentSubmit] recompose failed:', composeErr);
          // Don't fail the whole pipeline — the row exists with
          // the placeholder JPEG. Surface a warning but proceed.
          // The user's orb will show the placeholder #1 JPEG.
          // This is a degraded but recoverable state.
        }

        if (realBlob) {
          setStatus('reuploading');
          const { error: reuploadErr } = await supabase
            .storage
            .from('recap-moments')
            .upload(path, realBlob, {
              contentType: 'image/jpeg',
              cacheControl: '3600',
              upsert: true,  // Overwrite the placeholder
            });
          if (reuploadErr) {
            console.warn('[momentSubmit] re-upload failed:', reuploadErr);
            // Same degraded state — don't fail the pipeline.
          } else {
            console.log('[momentSubmit] real-number JPEG uploaded');
          }
        }
      }

      // ── Step 6: record_paint for collective canvas ────────
      setStatus('recording_paint');
      const hueId = snapToHueBucket(hueDegrees);
      // The legacy PaintScreen call signature included
      // p_visit_first_seen_at; passing it preserves canvas-contribution
      // behaviour against the live record_paint RPC even though the
      // 49c spec listed only 3 params.
      const { error: paintErr } = await supabase.rpc('record_paint', {
        p_venue_id: venueId,
        p_hue_id: hueId,
        p_visit_first_seen_at: new Date().toISOString(),
        p_paint_prompt_id: null,
      });

      if (paintErr) {
        console.warn('[momentSubmit] record_paint failed:', paintErr);
        // record_paint failure is non-fatal — the moment is
        // already submitted and the orb will appear. The user
        // just won't contribute to the collective canvas.
        // Log and proceed.
      }

      // ── Step 6.5: Schedule the 8am develop notification ───
      // Fire-and-forget. Any failure here is non-fatal — the moment
      // is already submitted and the orb appears. The user just
      // won't get a push tomorrow morning.
      scheduleMomentDevelopNotification({
        recapId,
        venueName,
        venueId,
        momentNumber,
        developedAt,
      }).catch(err => {
        console.warn('[momentSubmit] notification schedule failed (non-fatal):', err);
      });

      // ── Step 7: Success ────────────────────────────────────
      const finalResult: SubmitResult = {
        recapId,
        momentNumber,
        hueId,
      };
      setResult(finalResult);
      setStatus('success');
      console.log('[momentSubmit] pipeline complete:', finalResult);
      return finalResult;

    } catch (err: any) {
      const msg = err?.message || 'Unknown pipeline error';
      console.warn('[momentSubmit] pipeline threw:', msg, err);
      setStatus('error');
      setErrorCode('unknown');
      setError(msg);
      return null;
    }
  }, []);

  return { status, error, errorCode, result, submit, reset };
}
