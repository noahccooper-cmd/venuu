/**
 * profileSnapshot — generates a 1080×1080 PNG of the user's profile
 * for native share sheets. Pure canvas rendering; no external deps.
 *
 * Resolution choice: 1080² is the IG/X/iMessage share sweet spot —
 * looks crisp in feed, doesn't blow past upload limits.
 *
 * Font caveat: we wait on document.fonts.ready before drawing so
 * Satoshi has actually loaded. Without that, native systems render
 * with a fallback font and the snapshot looks unbranded.
 */

interface SnapshotOpts {
  displayName: string;
  username: string;
  city: string;
  level: string;         // e.g. 'NEWCOMER' | 'LOCAL LEGEND'
  avatarColor: string;   // hex, e.g. '#FF8200'
  initials: string;      // 1-2 chars
  nightsOut: number;
  venuesDiscovered: number;
  tasteAccuracy: number; // 0-100
  vibesLiked: string[];  // top 3-5 vibes
  shareToken: string;
}

const W = 1080;
const H = 1080;

const BRAND_ORANGE = '#FF8200';
const TEXT_PRIMARY = '#FFFFFF';
const TEXT_MUTED = '#8A8A95';
const TEXT_FADED = '#55555F';

// Pretty city labels for the snapshot.
function cityLabel(key: string): string {
  switch (key) {
    case 'knoxville':     return 'Knoxville, TN';
    case 'tampa':         return 'Tampa, FL';
    case 'st_petersburg': return 'St. Petersburg, FL';
    default:              return key.replace(/_/g, ' ');
  }
}

/** Rounded-rect helper. Path-only; caller fills/strokes. */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** Pillow draw — drop-shadow-less rounded chip with optional border. */
function drawChip(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number, cy: number,
  opts: { bg: string; border?: string; color: string; padX: number; padY: number; font: string },
) {
  ctx.font = opts.font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const metrics = ctx.measureText(text);
  const textW = metrics.width;
  const fontPx = parseInt(opts.font.match(/(\d+)px/)?.[1] ?? '14', 10);
  const w = Math.round(textW + opts.padX * 2);
  const h = Math.round(fontPx + opts.padY * 2);
  const x = Math.round(cx - w / 2);
  const y = Math.round(cy - h / 2);
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = opts.bg;
  ctx.fill();
  if (opts.border) {
    ctx.strokeStyle = opts.border;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.fillStyle = opts.color;
  ctx.fillText(text, cx, cy);
  return { w, h };
}

export async function generateProfileSnapshot(opts: SnapshotOpts): Promise<Blob> {
  // Wait for fonts so the rendered text isn't a generic fallback.
  // document.fonts.ready resolves even if Satoshi 404s — we just get
  // a less-pretty PNG in that edge case.
  try { await document.fonts.ready; } catch { /* ignore */ }

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unsupported');

  // ── Background — diagonal gradient matching app's deep glass.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0A0A10');
  bg.addColorStop(1, '#14141C');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // ── Top radial glow — same brand-orange wash the live cards have.
  const glow = ctx.createRadialGradient(W / 2, 80, 0, W / 2, 80, 520);
  glow.addColorStop(0, 'rgba(255, 130, 0, 0.30)');
  glow.addColorStop(0.5, 'rgba(255, 130, 0, 0.10)');
  glow.addColorStop(1, 'rgba(255, 130, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // ── Wordmark top-left.
  ctx.font = '900 64px Satoshi, sans-serif';
  ctx.fillStyle = BRAND_ORANGE;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('venuu', 64, 56);

  // ── Avatar circle — centered, ~28% from top.
  const avatarSize = 240;
  const avatarCX = W / 2;
  const avatarCY = 320;
  // Outer orange tint ring
  ctx.beginPath();
  ctx.arc(avatarCX, avatarCY, avatarSize / 2 + 14, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 130, 0, 0.18)';
  ctx.fill();
  // Avatar itself
  ctx.beginPath();
  ctx.arc(avatarCX, avatarCY, avatarSize / 2, 0, Math.PI * 2);
  ctx.fillStyle = opts.avatarColor || BRAND_ORANGE;
  ctx.fill();
  // Initials
  ctx.font = '900 96px Satoshi, sans-serif';
  ctx.fillStyle = TEXT_PRIMARY;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((opts.initials || '').slice(0, 2).toUpperCase(), avatarCX, avatarCY + 4);

  // ── Display name.
  ctx.font = '900 64px Satoshi, sans-serif';
  ctx.fillStyle = TEXT_PRIMARY;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(opts.displayName || opts.username, avatarCX, avatarCY + avatarSize / 2 + 36);

  // ── @username · city — muted line.
  ctx.font = '500 28px Satoshi, sans-serif';
  ctx.fillStyle = TEXT_MUTED;
  ctx.fillText(`@${opts.username} · ${cityLabel(opts.city)}`, avatarCX, avatarCY + avatarSize / 2 + 116);

  // ── Level pill — orange tint with brand orange border.
  drawChip(ctx, (opts.level || 'NEWCOMER').toUpperCase(), avatarCX, avatarCY + avatarSize / 2 + 182, {
    bg: 'rgba(255, 130, 0, 0.18)',
    border: 'rgba(255, 130, 0, 0.55)',
    color: '#FFD9B8',
    padX: 24,
    padY: 10,
    font: '700 24px Satoshi, sans-serif',
  });

  // ── Stats row — 3 columns evenly spaced.
  const statsY = 740;
  const statsCols = [
    { value: String(opts.nightsOut),         label: 'NIGHTS OUT' },
    { value: String(opts.venuesDiscovered),  label: 'VENUES' },
    { value: `${opts.tasteAccuracy}%`,       label: 'TASTE' },
  ];
  const colWidth = W / 3;
  for (let i = 0; i < statsCols.length; i++) {
    const cx = colWidth * (i + 0.5);
    ctx.font = '900 90px Satoshi, sans-serif';
    ctx.fillStyle = BRAND_ORANGE;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(statsCols[i].value, cx, statsY);
    ctx.font = '700 22px Satoshi, sans-serif';
    ctx.fillStyle = TEXT_MUTED;
    // simulate letter-spacing by joining with thin spaces
    const spaced = statsCols[i].label.split('').join(' ');
    ctx.fillText(spaced, cx, statsY + 36);
  }

  // ── My Vibe header + chips (top 5 max, fit on one line).
  if (opts.vibesLiked.length > 0) {
    const vibesY = 880;
    ctx.font = '700 22px Satoshi, sans-serif';
    ctx.fillStyle = TEXT_MUTED;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('M Y  V I B E', W / 2, vibesY);

    // Lay out chips horizontally, centered, with measured widths.
    const vibes = opts.vibesLiked.slice(0, 5);
    ctx.font = '700 28px Satoshi, sans-serif';
    const padX = 22;
    const padY = 14;
    const gap = 14;
    const widths = vibes.map(v => Math.round(ctx.measureText(v).width + padX * 2));
    const heights = vibes.map(() => 28 + padY * 2);
    const totalW = widths.reduce((a, b) => a + b, 0) + gap * (vibes.length - 1);
    let cx = (W - totalW) / 2;
    const chipY = vibesY + 50;
    for (let i = 0; i < vibes.length; i++) {
      const w = widths[i];
      const h = heights[i];
      drawChip(ctx, vibes[i], cx + w / 2, chipY + h / 2, {
        bg: 'rgba(255, 130, 0, 0.18)',
        border: 'rgba(255, 130, 0, 0.45)',
        color: '#FFD9B8',
        padX,
        padY,
        font: '700 28px Satoshi, sans-serif',
      });
      cx += w + gap;
    }
  }

  // ── Footer — small wordmark + share link.
  ctx.font = '900 24px Satoshi, sans-serif';
  ctx.fillStyle = BRAND_ORANGE;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('venuu', 64, H - 64);

  ctx.font = '500 18px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = TEXT_FADED;
  ctx.textAlign = 'right';
  ctx.fillText(`venuu.app/u/${opts.shareToken}`, W - 64, H - 64);

  // Convert to PNG blob.
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('canvas_toblob_failed'));
      },
      'image/png',
      0.95,
    );
  });
}
