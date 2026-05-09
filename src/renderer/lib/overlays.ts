import type { LyricLine, OverlayPng, Template } from '../../shared/types';

const OUT_W = 1080;
const OUT_H = 1920;

interface BuildOpts {
  lyrics: LyricLine[];
  template: Template;
  highlightKorean: boolean;
  durationSec: number;
  trackTitle?: string;
  artistName?: string;
}

/**
 * Slice lyrics into time chunks (using explicit timestamps if provided,
 * otherwise distributing evenly across the output duration).
 */
function sliceLyrics(lyrics: LyricLine[], durationSec: number): Array<{
  line: LyricLine;
  start: number;
  end: number;
}> {
  const visible = lyrics.filter(
    (l) => (l.text && l.text.trim()) || (l.ko && l.ko.trim()),
  );
  if (visible.length === 0) return [];
  const allTimed = visible.every(
    (l) =>
      typeof l.start === 'number' &&
      typeof l.end === 'number' &&
      (l.end ?? 0) > (l.start ?? 0),
  );
  if (allTimed) {
    return visible.map((line) => ({
      line,
      start: Math.max(0, line.start ?? 0),
      end: Math.min(durationSec, line.end ?? durationSec),
    }));
  }
  const slice = durationSec / visible.length;
  return visible.map((line, i) => ({
    line,
    start: i * slice,
    end: (i + 1) * slice,
  }));
}

/**
 * Build the full overlay set for a render: one full-frame PNG per lyric chunk,
 * plus an always-on metadata overlay (track title + artist) when those fields
 * are filled in.
 */
export async function buildOverlays(opts: BuildOpts): Promise<OverlayPng[]> {
  const out: OverlayPng[] = [];
  const chunks = sliceLyrics(opts.lyrics, opts.durationSec);

  for (const chunk of chunks) {
    const png = await renderLyricFrame(chunk.line, opts.template, opts.highlightKorean);
    out.push({ base64: png, startSec: chunk.start, endSec: chunk.end });
  }

  if ((opts.trackTitle && opts.trackTitle.trim()) || (opts.artistName && opts.artistName.trim())) {
    const png = await renderMetaFrame(
      opts.trackTitle ?? '',
      opts.artistName ?? '',
      opts.template,
    );
    out.push({ base64: png, startSec: 0, endSec: opts.durationSec });
  }

  return out;
}

async function renderLyricFrame(
  line: LyricLine,
  t: Template,
  highlightKorean: boolean,
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  // Vertical anchor and align.
  const yEN = lyricYBase(t);
  const yKO = yEN + Math.round(t.fontSize * 1.5);
  const xAnchor = lyricXAnchor(t);

  ctx.textBaseline = 'middle';
  ctx.textAlign = textAlign(t);

  // English line.
  if (line.text && line.text.trim()) {
    paintText(ctx, line.text, {
      x: xAnchor,
      y: yEN,
      fontSize: t.fontSize,
      fontWeight: t.fontWeight,
      fontFamily: t.fontFamily,
      color: t.lyricColor,
      maxWidth: OUT_W * 0.9,
    });
  }

  // Korean line.
  if (line.ko && line.ko.trim()) {
    paintText(ctx, line.ko, {
      x: xAnchor,
      y: yKO,
      fontSize: Math.round(t.fontSize * 0.78),
      fontWeight: 500,
      fontFamily: t.fontFamily,
      color: highlightKorean ? t.lyricSubColor : t.lyricColor,
      maxWidth: OUT_W * 0.9,
    });
  }

  return await canvasToBase64Png(canvas);
}

async function renderMetaFrame(
  title: string,
  artist: string,
  t: Template,
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const cx = OUT_W / 2;
  const yTitle = Math.round(OUT_H * 0.78);

  if (title.trim()) {
    paintText(ctx, title, {
      x: cx,
      y: yTitle,
      fontSize: 38,
      fontWeight: 700,
      fontFamily: t.fontFamily,
      color: t.lyricColor,
      maxWidth: OUT_W * 0.9,
    });
  }
  if (artist.trim()) {
    paintText(ctx, artist, {
      x: cx,
      y: yTitle + 50,
      fontSize: 28,
      fontWeight: 500,
      fontFamily: t.fontFamily,
      color: hexWithAlpha(t.lyricColor, 0.7),
      maxWidth: OUT_W * 0.9,
    });
  }
  return await canvasToBase64Png(canvas);
}

interface PaintOpts {
  x: number;
  y: number;
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
  color: string;
  maxWidth: number;
}

function paintText(ctx: CanvasRenderingContext2D, text: string, p: PaintOpts): void {
  const fontStack = `${p.fontWeight} ${p.fontSize}px ${p.fontFamily}, "Noto Sans KR", system-ui, sans-serif`;
  ctx.font = fontStack;

  // Word-wrap across multiple lines.
  const wrapped = wrapText(ctx, text, p.maxWidth);
  const lineHeight = Math.round(p.fontSize * 1.18);
  const totalHeight = wrapped.length * lineHeight;
  let y = p.y - totalHeight / 2 + lineHeight / 2;

  for (const ln of wrapped) {
    // Drop shadow for legibility.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = p.color;
    ctx.fillText(ln, p.x, y);
    ctx.restore();
    y += lineHeight;
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let cur = words[0];
  for (let i = 1; i < words.length; i++) {
    const tentative = `${cur} ${words[i]}`;
    if (ctx.measureText(tentative).width <= maxWidth) {
      cur = tentative;
    } else {
      lines.push(cur);
      cur = words[i];
    }
  }
  lines.push(cur);
  return lines;
}

function lyricYBase(t: Template): number {
  switch (t.lyricPosition) {
    case 'top':
      return Math.round(OUT_H * 0.12);
    case 'center':
      return Math.round(OUT_H * 0.66);
    case 'bottom':
    default:
      return Math.round(OUT_H * 0.78);
  }
}

function lyricXAnchor(t: Template): number {
  switch (t.lyricAlign) {
    case 'left':
      return 80;
    case 'right':
      return OUT_W - 80;
    case 'center':
    default:
      return OUT_W / 2;
  }
}

function textAlign(t: Template): CanvasTextAlign {
  switch (t.lyricAlign) {
    case 'left':
      return 'left';
    case 'right':
      return 'right';
    case 'center':
    default:
      return 'center';
  }
}

function hexWithAlpha(hex: string, alpha: number): string {
  const c = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function canvasToBase64Png(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas toBlob returned null'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
      reader.onload = () => {
        const dataUrl = String(reader.result ?? '');
        const idx = dataUrl.indexOf(',');
        resolve(idx >= 0 ? dataUrl.slice(idx + 1) : '');
      };
      reader.readAsDataURL(blob);
    }, 'image/png');
  });
}
