import { useCallback, useState, type RefObject } from 'react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import type { Map as MapboxMap } from 'mapbox-gl';
import { supabase } from '../lib/supabase';
import { generateGlobeCaption } from '../lib/captionGenerator';
import { generateGlobeSnapshot, dataUrlToBlob } from '../lib/snapshotGenerator';
import type { CityAggregate } from './useCityAggregates';

interface UseShareGlobeOpts {
  /** Ref to the live Mapbox map. Passed as a ref (not a value) so the
   *  hook reads the latest .current at share-time — the map mounts
   *  asynchronously after this hook is called. */
  mapRef: RefObject<MapboxMap | null>;
  aggregates: CityAggregate[];
  totalPeopleOut: number;
  /** Supabase auth uid; null for guest users. */
  userId: string | null;
}

interface UseShareGlobeReturn {
  share: () => Promise<void>;
  sharing: boolean;
  error: Error | null;
}

/**
 * Captures the current globe-view canvas, composites the venuu
 * branding overlay, logs an analytics row to public.globe_snapshots,
 * then routes through the platform's native share sheet (Capacitor
 * on iOS, Web Share API in the browser, and a final image-in-tab
 * fallback for desktop browsers without share API).
 */
export function useShareGlobe(opts: UseShareGlobeOpts): UseShareGlobeReturn {
  const { mapRef, aggregates, totalPeopleOut, userId } = opts;
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const share = useCallback(async () => {
    const map = mapRef.current;
    if (!map) {
      setError(new Error('Map not ready'));
      return;
    }

    setSharing(true);
    setError(null);

    try {
      const caption = generateGlobeCaption(aggregates, totalPeopleOut);
      const dataUrl = await generateGlobeSnapshot({
        map, totalPeopleOut, aggregates, caption,
      });

      // Fire-and-forget analytics row — never block the share UX on it.
      void supabase
        .from('globe_snapshots')
        .insert({
          user_id: userId,
          total_people_out: totalPeopleOut,
          city_count: aggregates.length,
          cities_snapshot: aggregates,
          caption,
          shared_to: Capacitor.isNativePlatform() ? 'native_share' : 'web_share',
        })
        .then(({ error: insertErr }) => {
          if (insertErr) console.warn('[share] snapshot log failed:', insertErr.message);
        });

      if (Capacitor.isNativePlatform()) {
        // Convert dataURL → blob → base64 → temp file via filesystem,
        // then hand the file URI to the iOS share sheet.
        const blob = dataUrlToBlob(dataUrl);
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1] ?? '');
          };
          reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
        });
        reader.readAsDataURL(blob);
        const base64 = await base64Promise;

        try {
          const { Filesystem, Directory } = await import('@capacitor/filesystem');
          const fileName = `venuu-globe-${Date.now()}.jpg`;
          const writeResult = await Filesystem.writeFile({
            path: fileName,
            data: base64,
            directory: Directory.Cache,
          });
          await Share.share({
            title: 'venuu tonight',
            text: caption,
            url: writeResult.uri,
            dialogTitle: 'Share venuu',
          });
        } catch (fsErr) {
          // Filesystem write or share-with-file failed — degrade to text+url.
          console.warn('[share] filesystem fallback:', fsErr);
          await Share.share({
            title: 'venuu tonight',
            text: `${caption}\n\nvenuu.app`,
            dialogTitle: 'Share venuu',
          });
        }
      } else if (typeof navigator !== 'undefined' && 'share' in navigator) {
        const blob = dataUrlToBlob(dataUrl);
        const file = new File([blob], 'venuu-globe.jpg', { type: 'image/jpeg' });
        try {
          await navigator.share({
            title: 'venuu tonight',
            text: caption,
            files: [file],
          });
        } catch (shareErr) {
          // User-cancelled share is normal; rethrow others.
          const name = (shareErr as Error)?.name;
          if (name !== 'AbortError') throw shareErr;
        }
      } else {
        // Desktop fallback: open the snapshot in a new tab so user can save.
        const newTab = window.open();
        if (newTab) {
          newTab.document.write(
            `<html><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh;">
              <img src="${dataUrl}" style="max-width:100%;max-height:100vh;" alt="venuu tonight" />
            </body></html>`,
          );
        }
      }
    } catch (err) {
      console.error('[share] failed:', err);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setSharing(false);
    }
  }, [mapRef, aggregates, totalPeopleOut, userId]);

  return { share, sharing, error };
}
