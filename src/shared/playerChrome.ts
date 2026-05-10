import type { Template } from './types';

/**
 * Player-style chrome painters for the music-app templates. These add the
 * "now playing" feel — title/artist line, progress, a play control area —
 * without copying any platform's actual UI / logo.
 *
 * Pure self-design. Color, layout, and proportions are picked to evoke
 * a generic player rather than impersonate a specific brand. No logos,
 * no proprietary glyphs, no copied marquee fonts.
 *
 * All painters are 1080×1920 canonical and run as part of renderScene's
 * chrome step (preview + export overlay parity).
 */

// 1080×1920 canonical — matches scene.ts SCENE_W / SCENE_H. Inlined here
// to keep playerChrome.ts importable without pulling in the full scene
// painter (and to avoid a circular import if scene.ts grows to depend on
// this module too).
const SCENE_W = 1080;
const SCENE_H = 1920;

export type PlayerChromeStyle = 'apple-like' | 'spotify-like' | 'youtube-like';

export interface PlayerChromeOpts {
  /** 0..1 progress through the clip. */
  ratio: number;
  /** Total clip duration in seconds (for the time stamps). */
  durationSec: number;
  /** Live amplitude 0..1 from the reactive state — drives equalizer. */
  amplitude: number | null;
  trackTitle?: string;
  artistName?: string;
  /** Template that owns this paint. Used for accent / text color hints. */
  template: Template;
}

/** Paint chrome chosen by `style`. No-op when style is unknown. */
export function paintPlayerChrome(
  ctx: CanvasRenderingContext2D,
  style: PlayerChromeStyle | null | undefined,
  opts: PlayerChromeOpts,
): void {
  switch (style) {
    case 'apple-like':
      paintAppleLikePlayer(ctx, opts);
      return;
    case 'spotify-like':
      paintSpotifyLikePlayer(ctx, opts);
      return;
    case 'youtube-like':
      paintYoutubeLikePlayer(ctx, opts);
      return;
    default:
      return;
  }
}

/* ----------------------------------------- Apple-like (light glass) */

function paintAppleLikePlayer(ctx: CanvasRenderingContext2D, o: PlayerChromeOpts): void {
  const W = SCENE_W;
  const H = SCENE_H;
  const cardX = 80;
  const cardW = W - cardX * 2;
  const cardY = Math.round(H * 0.78);
  const cardH = 240;
  const accent = o.template.lyricSubColor;
  const fg = o.template.lyricColor;

  // Soft glass card background — low-alpha black, subtle white border.
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundedRect(ctx, cardX, cardY, cardW, cardH, 28);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(cardX, cardY, cardW, 1);
  ctx.restore();

  // Track title / artist line.
  paintTrackLine(ctx, o, cardX + 28, cardY + 28, cardW - 56);

  // Thin progress bar.
  const trackY = cardY + cardH - 78;
  paintProgressBar(ctx, cardX + 28, trackY, cardW - 56, 4, o.ratio, accent, fg, 2);

  // Time labels.
  paintTimeRow(ctx, cardX + 28, trackY + 16, cardW - 56, o);

  // Play / prev / next group, minimal Apple-feel iconography.
  const cy = cardY + cardH - 38;
  const cx = (W) / 2;
  drawPrevIcon(ctx, cx - 92, cy, 18, fg);
  drawCirclePlay(ctx, cx, cy, 28, fg, 'rgba(255,255,255,0.08)');
  drawNextIcon(ctx, cx + 92, cy, 18, fg);
}

/* ----------------------------------------- Spotify-like (dark + green) */

function paintSpotifyLikePlayer(ctx: CanvasRenderingContext2D, o: PlayerChromeOpts): void {
  const W = SCENE_W;
  const H = SCENE_H;
  const cardX = 60;
  const cardW = W - cardX * 2;
  const cardY = Math.round(H * 0.79);
  const cardH = 230;
  const fg = o.template.lyricColor;
  // Spotify-feel uses a green-ish accent — pull from template subColor so a
  // user changing template colors keeps them consistent.
  const accent = o.template.lyricSubColor;

  // Dark card with subtle gradient.
  ctx.save();
  const grad = ctx.createLinearGradient(0, cardY, 0, cardY + cardH);
  grad.addColorStop(0, 'rgba(18,18,18,0.85)');
  grad.addColorStop(1, 'rgba(8,8,8,0.95)');
  ctx.fillStyle = grad;
  roundedRect(ctx, cardX, cardY, cardW, cardH, 18);
  ctx.restore();

  // Title / artist top-left.
  paintTrackLine(ctx, o, cardX + 24, cardY + 26, cardW * 0.7);

  // Equalizer bars right of title — react to amplitude.
  paintEqualizerBars(ctx, cardX + cardW - 140, cardY + 30, 110, 60, accent, o.amplitude);

  // Slim progress bar near bottom.
  const trackY = cardY + cardH - 64;
  paintProgressBar(ctx, cardX + 24, trackY, cardW - 48, 3, o.ratio, accent, fg, 1.5);
  paintTimeRow(ctx, cardX + 24, trackY + 14, cardW - 48, o);

  // Centered play icon — bigger, rounded square.
  const cy = cardY + cardH - 40;
  drawCirclePlay(ctx, W / 2, cy, 22, fg, 'rgba(255,255,255,0.12)');
}

/* ----------------------------------------- YouTube Music-like (dark + red) */

function paintYoutubeLikePlayer(ctx: CanvasRenderingContext2D, o: PlayerChromeOpts): void {
  const W = SCENE_W;
  const H = SCENE_H;
  const cardX = 60;
  const cardW = W - cardX * 2;
  const cardY = Math.round(H * 0.79);
  const cardH = 240;
  const fg = o.template.lyricColor;
  const accent = o.template.lyricSubColor;

  ctx.save();
  ctx.fillStyle = 'rgba(15,15,15,0.92)';
  roundedRect(ctx, cardX, cardY, cardW, cardH, 24);
  ctx.restore();

  paintTrackLine(ctx, o, cardX + 24, cardY + 24, cardW - 48);

  // Big circular play in the center.
  const cy = cardY + cardH / 2 + 6;
  const cx = W / 2;
  ctx.save();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, cy, 36, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy - 14);
  ctx.lineTo(cx + 16, cy);
  ctx.lineTo(cx - 10, cy + 14);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Progress bar at the very bottom of the card.
  const trackY = cardY + cardH - 36;
  paintProgressBar(ctx, cardX + 24, trackY, cardW - 48, 3, o.ratio, accent, fg, 1.5);
  paintTimeRow(ctx, cardX + 24, trackY + 14, cardW - 48, o);
}

/* ----------------------------------------- shared sub-painters */

function paintTrackLine(
  ctx: CanvasRenderingContext2D,
  o: PlayerChromeOpts,
  x: number,
  y: number,
  maxW: number,
): void {
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.fillStyle = o.template.lyricColor;
  ctx.font = `700 28px ${o.template.fontFamily}`;
  const title = (o.trackTitle ?? '').trim() || 'Now Playing';
  ctx.fillText(ellipsize(ctx, title, maxW), x, y);
  ctx.font = `500 18px ${o.template.fontFamily}`;
  ctx.fillStyle = withAlphaChrome(o.template.lyricColor, 0.65);
  const artist = (o.artistName ?? '').trim();
  if (artist) ctx.fillText(ellipsize(ctx, artist, maxW), x, y + 36);
  ctx.restore();
}

function paintProgressBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  accent: string,
  fg: string,
  radius: number,
): void {
  ctx.save();
  ctx.fillStyle = withAlphaChrome(fg, 0.18);
  roundedRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = accent;
  roundedRect(ctx, x, y, w * Math.max(0, Math.min(1, ratio)), h, radius);
  // Playhead dot.
  const hx = x + w * Math.max(0, Math.min(1, ratio));
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.arc(hx, y + h / 2, h * 1.6 + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintTimeRow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  o: PlayerChromeOpts,
): void {
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.font = `500 12px ${o.template.fontFamily}`;
  ctx.fillStyle = withAlphaChrome(o.template.lyricColor, 0.6);
  const cur = formatMmSs(o.ratio * o.durationSec);
  const tot = formatMmSs(o.durationSec);
  ctx.textAlign = 'left';
  ctx.fillText(cur, x, y);
  ctx.textAlign = 'right';
  ctx.fillText(tot, x + w, y);
  ctx.restore();
}

function paintEqualizerBars(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  amp: number | null,
): void {
  const bars = 7;
  const slot = w / bars;
  ctx.save();
  for (let i = 0; i < bars; i++) {
    const seed = (i * 17) % 100;
    const baseRatio = 0.25 + (seed / 100) * 0.35;
    const liveBoost = amp == null ? 0 : amp * 0.6 * (0.5 + 0.5 * Math.sin(i * 1.1));
    const bh = Math.max(6, Math.min(h, h * (baseRatio + liveBoost)));
    const bx = x + i * slot;
    const by = y + (h - bh);
    ctx.fillStyle = withAlphaChrome(color, amp != null && amp > 0.5 ? 0.95 : 0.7);
    roundedRect(ctx, bx, by, Math.max(3, slot - 4), bh, 2);
  }
  ctx.restore();
}

/* ----------------------------------------- icon helpers */

function drawCirclePlay(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fg: string,
  bg: string,
): void {
  ctx.save();
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.32, cy - r * 0.5);
  ctx.lineTo(cx + r * 0.55, cy);
  ctx.lineTo(cx - r * 0.32, cy + r * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPrevIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(cx - size * 0.55, cy - size * 0.7, 4, size * 1.4);
  ctx.beginPath();
  ctx.moveTo(cx + size * 0.5, cy - size * 0.7);
  ctx.lineTo(cx + size * 0.5, cy + size * 0.7);
  ctx.lineTo(cx - size * 0.35, cy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawNextIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(cx + size * 0.55 - 4, cy - size * 0.7, 4, size * 1.4);
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.5, cy - size * 0.7);
  ctx.lineTo(cx - size * 0.5, cy + size * 0.7);
  ctx.lineTo(cx + size * 0.35, cy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ----------------------------------------- text + helpers */

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + '…';
}

function formatMmSs(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  if (w <= 0 || h <= 0) return;
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fill();
}

function withAlphaChrome(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  if (color.startsWith('rgba(') || color.startsWith('rgb(')) {
    const m = color.match(/^rgba?\(([^)]+)\)$/);
    if (!m) return color;
    const parts = m[1].split(',').map((s) => s.trim());
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${a})`;
  }
  const cleaned = color.startsWith('#') ? color.slice(1) : color;
  if (cleaned.length !== 6) return color;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
