/**
 * Share / save the composed moment JPEG via iOS native share sheet.
 *
 * Replaces the prior Filesystem-write-to-Documents approach. The
 * Share plugin opens iOS's native share sheet so the user can pick:
 *   - "Save Image" → writes to actual Photos library
 *   - "AirDrop", "Messages", "Mail", "IG Stories", "Save to Files"
 *   - Any third-party app that registers as a share target
 *
 * The Share plugin's share() resolves with the chosen activityType
 * (or rejects if user dismisses the sheet without picking anything).
 * We translate both into the existing SaveStatus enum so the call
 * site in CaptureSurface stays unchanged.
 *
 * iOS REQUIREMENT: Share.share() with `files` parameter needs a
 * file URI, not a Blob. So we still write the JPEG to a TEMP
 * Cache directory first, then hand the URI to the share sheet.
 * iOS handles cleanup of the temp file automatically.
 */

import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';

export type SaveStatus =
  | 'idle'
  | 'saving'
  | 'success'
  | 'permission_denied'
  | 'unsupported'
  | 'cancelled'   // NEW — user dismissed share sheet without picking
  | 'error';

export interface SaveResult {
  status: SaveStatus;
  error?: string;
  /** Which iOS share activity completed (e.g.
   *  'com.apple.UIKit.activity.SaveToCameraRoll' for Save Image).
   *  Only set on 'success'. Useful for future analytics. */
  activityType?: string;
}

/**
 * Convert a Blob to a base64 string (without the data: prefix).
 * Same helper as before — preserved for parity.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Share / save the composed moment JPEG.
 *
 * @param blob       The composed JPEG (from useSelfieCapture.composedBlob)
 * @param venueName  Used to generate a friendly filename
 * @returns SaveResult — status reflects whether user shared, cancelled,
 *                       or hit an error
 */
export async function saveMomentToPhotos(
  blob: Blob,
  venueName: string
): Promise<SaveResult> {
  console.log('[saveMomentToPhotos] starting, blob size:', blob.size);

  // Share plugin only works on native iOS/Android
  if (!Capacitor.isNativePlatform()) {
    console.warn('[saveMomentToPhotos] not on native platform');
    return {
      status: 'unsupported',
      error: 'Share requires native app (not web)',
    };
  }

  try {
    // Step 1: write JPEG to Cache directory so Share has a file URI.
    // Cache is auto-cleaned by iOS; we don't need to manage lifecycle.
    const safeVenue = venueName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `venuu-${safeVenue}-${timestamp}.jpg`;

    const base64 = await blobToBase64(blob);

    const written = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
      recursive: false,
    });

    console.log('[saveMomentToPhotos] cache file written:', written.uri);

    // Step 2: open the iOS native share sheet with the file URI.
    // The plugin returns { activityType } on success, throws on cancel.
    const result = await Share.share({
      title: `venuu — ${venueName}`,
      text: `my moment at ${venueName.toLowerCase()} · venuu`,
      url: written.uri,
      dialogTitle: 'save your moment',
    });

    console.log('[saveMomentToPhotos] share resolved:', result);

    return {
      status: 'success',
      activityType: result.activityType,
    };
  } catch (err: any) {
    const msg = err?.message || '';
    console.warn('[saveMomentToPhotos] share threw:', msg, err);

    // iOS Share plugin throws when user cancels — distinguish from real errors.
    // Known cancel messages (vary by iOS version / plugin version):
    //   - "Share canceled"
    //   - "User cancelled"
    //   - empty string (some versions just throw with no message)
    const lower = msg.toLowerCase();
    if (
      lower.includes('cancel') ||
      lower.includes('dismiss') ||
      msg === '' ||
      err?.name === 'UserCancellationError'
    ) {
      console.log('[saveMomentToPhotos] user dismissed share sheet');
      return { status: 'cancelled' };
    }

    // Permission-related (rare with share sheet but possible)
    if (
      lower.includes('permission') ||
      lower.includes('denied') ||
      lower.includes('not authorized')
    ) {
      return {
        status: 'permission_denied',
        error: msg,
      };
    }

    return {
      status: 'error',
      error: msg || 'Share failed',
    };
  }
}
