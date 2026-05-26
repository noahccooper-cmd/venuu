/**
 * Moment Composite — engraves the venuu identity into the captured frame.
 *
 * Renders to an offscreen canvas:
 *   1. The captured selfie frame (flipped horizontally to match the
 *      mirrored live preview the user saw)
 *   2. Hue bleed gradient from the frame edges inward (subtle bath)
 *   3. Top gradient + Polaroid header (✦ + venue name + timestamp)
 *   4. Bottom gradient + Moment number (✦ + #N)
 *   5. Hue frame border (the outermost rounded ring)
 *
 * All in the EXACT colors and proportions the user saw on screen.
 * The exported JPEG IS the artifact. It travels with venuu's identity
 * baked in — IG Story, AirDrop, screenshot, anywhere.
 *
 * Output: 1080x1920 JPEG Blob, ~85% quality.
 */

export interface MomentCompositeOptions {
  /** The captured frame as an ImageBitmap (from createImageBitmap on video) */
  frame: ImageBitmap;
  /** Active hue degrees 0-360 */
  hueDegrees: number;
  /** Active hue lightness 30-70 */
  hueLightness: number;
  /** Venue name (will be lowercased) */
  venueName: string;
  /** User's moment number (their nth capture ever) */
  momentNumber: number;
  /** Optional override for capture timestamp (defaults to now) */
  capturedAt?: Date;
}

// Pearlescent cream-gold — the eternal venuu mark color (matches CSS)
const PEARL = '#FFF8E7';

/**
 * Convert HSL to a CSS hsl() string for canvas use.
 */
function hsl(h: number, s: number, l: number, a = 1): string {
  if (a < 1) return `hsla(${h}, ${s}%, ${l}%, ${a})`;
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/**
 * Format the capture timestamp as "may 25, 2026 · 11:47pm"
 */
function formatTimestamp(d: Date): string {
  const dateStr = d.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  }).toLowerCase();
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  const displayHours = hours % 12 || 12;
  const timeStr = `${displayHours}:${minutes.toString().padStart(2, '0')}${ampm}`;
  return `${dateStr} · ${timeStr}`;
}

/**
 * Compose the moment JPEG and return as a Blob.
 *
 * @returns Promise<Blob> — JPEG, ~85% quality, 1080x1920
 */
export async function composeMomentJPEG(
  opts: MomentCompositeOptions
): Promise<Blob> {
  const {
    frame, hueDegrees, hueLightness, venueName, momentNumber,
  } = opts;
  const capturedAt = opts.capturedAt ?? new Date();

  // Canvas dimensions — portrait 9:16 (matches IG Story spec)
  const W = 1080;
  const H = 1920;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('composeMomentJPEG: 2d context unavailable');
  }

  // ── Step 1: paint the captured frame, mirrored ───────────
  //
  // The user saw a mirrored preview (transform: scaleX(-1)).
  // We mirror the captured frame to match what they expected.
  // We also apply objectFit: 'contain' equivalent — letterbox the
  // source frame into a 9:16 canvas centered, with black bars on
  // top/bottom if source aspect ratio differs.

  const srcW = frame.width;
  const srcH = frame.height;
  const srcAR = srcW / srcH;
  const dstAR = W / H;

  let dx = 0, dy = 0, dw = W, dh = H;
  if (srcAR > dstAR) {
    // Source is wider than 9:16 — letterbox top/bottom
    dh = W / srcAR;
    dy = (H - dh) / 2;
  } else if (srcAR < dstAR) {
    // Source is narrower than 9:16 — letterbox left/right
    dw = H * srcAR;
    dx = (W - dw) / 2;
  }

  // Fill background black first (for letterbox bars)
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // Mirror horizontally before drawing the frame
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(frame, W - dx - dw, dy, dw, dh);
  ctx.restore();

  // ── Step 2: hue bleed (inward bloom from edges) ───────────

  // Radial bleed
  const radialGrad = ctx.createRadialGradient(
    W / 2, H / 2, Math.min(W, H) * 0.35,
    W / 2, H / 2, Math.max(W, H) * 0.7
  );
  radialGrad.addColorStop(0, 'rgba(0,0,0,0)');
  radialGrad.addColorStop(1, hsl(hueDegrees, 80, hueLightness, 0.10));
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = radialGrad;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';

  // Linear bleed top + bottom (frame-symmetric edge bloom)
  const linearGradTop = ctx.createLinearGradient(0, 0, 0, H * 0.25);
  linearGradTop.addColorStop(0, hsl(hueDegrees, 80, hueLightness, 0.08));
  linearGradTop.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = linearGradTop;
  ctx.fillRect(0, 0, W, H * 0.25);

  const linearGradBot = ctx.createLinearGradient(0, H * 0.75, 0, H);
  linearGradBot.addColorStop(0, 'rgba(0,0,0,0)');
  linearGradBot.addColorStop(1, hsl(hueDegrees, 80, hueLightness, 0.08));
  ctx.fillStyle = linearGradBot;
  ctx.fillRect(0, H * 0.75, W, H * 0.25);
  ctx.globalCompositeOperation = 'source-over';

  // ── Step 3: top gradient (header readability foundation) ──

  const topGrad = ctx.createLinearGradient(0, 0, 0, H * 0.20);
  topGrad.addColorStop(0, 'rgba(0,0,0,0.48)');
  topGrad.addColorStop(0.55, 'rgba(0,0,0,0.26)');
  topGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, W, H * 0.20);

  // ── Step 4: Polaroid header text ──────────────────────────
  //
  // Layout:
  //   ✦ sunspot              (✦ pearl, name hue, 34px ratio)
  //      may 25, 2026 · 11:47pm  (timestamp hue, 19px ratio)
  //
  // Scale: the live UI uses 34px venue name on ~340-380px frames.
  // On 1080W canvas, equivalent scale is ~96px venue, ~54px timestamp.
  // ✦ glyph slightly smaller than venue name — ~68px.

  const headerLeft = 60;       // matches paddingLeft: '20px' on ~380px width
  const headerTop = 72;        // matches paddingTop: '20px' + marginTop: '8px'
  const hueText = hsl(hueDegrees, 80, hueLightness);

  // ── ✦ glyph (pearlescent) ─────────────
  ctx.fillStyle = PEARL;
  ctx.font = '600 68px Caveat, cursive';
  ctx.textBaseline = 'alphabetic';

  // Subtle pearl glow under the glyph
  ctx.shadowColor = 'rgba(255, 248, 231, 0.85)';
  ctx.shadowBlur = 22;
  ctx.fillText('✦', headerLeft, headerTop + 64);
  ctx.shadowBlur = 0;

  // ── Venue name (hue) ─────────────
  ctx.fillStyle = hueText;
  ctx.font = '600 96px Caveat, cursive';
  ctx.shadowColor = hsl(hueDegrees, 90, Math.min(80, hueLightness + 10), 0.5);
  ctx.shadowBlur = 28;
  const lowerVenue = venueName.toLowerCase();
  ctx.fillText(lowerVenue, headerLeft + 90, headerTop + 64);
  ctx.shadowBlur = 0;

  // ── Timestamp (hue, indented under venue name) ─────────────
  ctx.font = '500 54px Caveat, cursive';
  ctx.shadowColor = hsl(hueDegrees, 90, Math.min(80, hueLightness + 10), 0.5);
  ctx.shadowBlur = 18;
  ctx.fillText(formatTimestamp(capturedAt), headerLeft + 90, headerTop + 132);
  ctx.shadowBlur = 0;

  // ── Step 5: bottom gradient (number readability) ──────────

  const botGrad = ctx.createLinearGradient(0, H * 0.78, 0, H);
  botGrad.addColorStop(0, 'rgba(0,0,0,0)');
  botGrad.addColorStop(0.5, 'rgba(0,0,0,0.30)');
  botGrad.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = botGrad;
  ctx.fillRect(0, H * 0.78, W, H * 0.22);

  // ── Step 6: Moment number (pearlescent ✦ + #N) ───────────
  //
  // Right-aligned in bottom-right.
  // ✦ glyph (~62px) + #N (108px) on a single line.

  const numberText = `#${momentNumber}`;
  ctx.font = '700 108px Caveat, cursive';
  const numberWidth = ctx.measureText(numberText).width;

  ctx.font = '600 62px Caveat, cursive';
  const glyphWidth = ctx.measureText('✦').width;

  // Compute right-anchored positions
  const numberY = H - 80;
  const numberX = W - 60 - numberWidth;
  const glyphX = numberX - glyphWidth - 12;

  // ✦ glyph
  ctx.fillStyle = PEARL;
  ctx.font = '600 62px Caveat, cursive';
  ctx.shadowColor = 'rgba(255, 248, 231, 0.9)';
  ctx.shadowBlur = 20;
  ctx.fillText('✦', glyphX, numberY);
  ctx.shadowBlur = 0;

  // #N — quadruple-layer warm glow
  ctx.fillStyle = PEARL;
  ctx.font = '700 108px Caveat, cursive';

  // Glow pass 1 (soft outer)
  ctx.shadowColor = 'rgba(255, 248, 231, 0.32)';
  ctx.shadowBlur = 60;
  ctx.fillText(numberText, numberX, numberY);

  // Glow pass 2 (mid)
  ctx.shadowColor = 'rgba(255, 252, 239, 0.65)';
  ctx.shadowBlur = 28;
  ctx.fillText(numberText, numberX, numberY);

  // Glow pass 3 (tight + final fill)
  ctx.shadowColor = 'rgba(255, 248, 231, 0.92)';
  ctx.shadowBlur = 12;
  ctx.fillText(numberText, numberX, numberY);
  ctx.shadowBlur = 0;

  // ── Step 7: hue frame border (the outermost ring) ────────

  // Inner edge of frame is at canvas edges. We draw a stroke
  // INSIDE the canvas bounds matching the live UI's 3px border
  // on ~380px frame → ~8.5px stroke on 1080W canvas.

  const borderWidth = 9;
  ctx.strokeStyle = hueText;
  ctx.lineWidth = borderWidth;
  // Inset half the line width so the stroke sits cleanly inside
  ctx.strokeRect(
    borderWidth / 2,
    borderWidth / 2,
    W - borderWidth,
    H - borderWidth
  );

  // Subtle inner inset glow (matches CSS inset box-shadow)
  ctx.strokeStyle = hsl(hueDegrees, 90, Math.min(80, hueLightness + 10), 0.18);
  ctx.lineWidth = 2;
  ctx.strokeRect(
    borderWidth + 2,
    borderWidth + 2,
    W - 2 * (borderWidth + 2),
    H - 2 * (borderWidth + 2)
  );

  // ── Step 8: export to JPEG Blob ───────────────────────────

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          console.log('[momentComposite] JPEG exported,',
            `${(blob.size / 1024).toFixed(0)}KB`);
          resolve(blob);
        } else {
          reject(new Error('toBlob returned null'));
        }
      },
      'image/jpeg',
      0.85
    );
  });
}
