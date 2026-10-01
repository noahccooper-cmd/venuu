import type { Map as MapboxMap } from 'mapbox-gl';
import type { CityAggregate } from '../hooks/useCityAggregates';

interface SnapshotOptions {
  map: MapboxMap;
  totalPeopleOut: number;
  aggregates: CityAggregate[];
  caption: string;
}

/**
 * Composites the current Mapbox canvas with a venuu-branded overlay
 * and returns the result as a JPEG data URL ready for native sharing.
 *
 * Layout (positions are fractions of canvas width/height so the image
 * scales gracefully across phone DPRs):
 *   • venuu wordmark, top-left  (4% inset)
 *   • bottom gradient fade for readability
 *   • people-out counter, large, centered ~85% from top
 *   • "out tonight · across N cities" subtitle below
 *   • timestamp bottom-right, venuu.app bottom-left
 */
export async function generateGlobeSnapshot(opts: SnapshotOptions): Promise<string> {
  const { map, totalPeopleOut, aggregates } = opts;

  // Force the map to flush a frame so the canvas is in a known state.
  map.triggerRepaint();
  await new Promise(resolve => requestAnimationFrame(resolve));

  const mapCanvas = map.getCanvas();
  const width = mapCanvas.width;
  const height = mapCanvas.height;

  const composite = document.createElement('canvas');
  composite.width = width;
  composite.height = height;
  const ctx = composite.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context');

  // 1. Map
  ctx.drawImage(mapCanvas, 0, 0);

  // 2. Bottom gradient — caption legibility
  const gradient = ctx.createLinearGradient(0, height * 0.7, 0, height);
  gradient.addColorStop(0, 'rgba(10, 14, 28, 0)');
  gradient.addColorStop(1, 'rgba(10, 14, 28, 0.95)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, height * 0.7, width, height * 0.3);

  // 3. venuu wordmark (top-left)
  ctx.fillStyle = '#FF8200';
  ctx.font = `800 ${Math.floor(width * 0.04)}px -apple-system, Satoshi, system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('venuu', width * 0.04, height * 0.05);

  // 4. People-out counter (center, large) with orange glow
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const counterY = height * 0.85;

  ctx.shadowColor = 'rgba(255, 130, 0, 0.6)';
  ctx.shadowBlur = 20;
  ctx.fillStyle = '#FF8200';
  ctx.font = `700 ${Math.floor(width * 0.07)}px -apple-system, Satoshi, system-ui, sans-serif`;
  ctx.fillText(totalPeopleOut.toLocaleString(), width / 2, counterY);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // 5. Subtitle
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.font = `500 ${Math.floor(width * 0.022)}px -apple-system, Satoshi, system-ui, sans-serif`;
  ctx.fillText(
    `out tonight · across ${aggregates.length} cities`,
    width / 2,
    counterY + Math.floor(width * 0.05),
  );

  // 6. Timestamp (bottom-right)
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.font = `500 ${Math.floor(width * 0.016)}px -apple-system, Satoshi, system-ui, sans-serif`;
  ctx.fillText(`${dateStr} · ${timeStr}`, width - (width * 0.04), height - (height * 0.025));

  // 7. venuu.app URL (bottom-left)
  ctx.textAlign = 'left';
  ctx.fillText('venuu.app', width * 0.04, height - (height * 0.025));

  return composite.toDataURL('image/jpeg', 0.92);
}

/**
 * Converts a data URL to a Blob for native sharing pipelines that
 * prefer binary file inputs (Web Share API, Filesystem.writeFile).
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}
