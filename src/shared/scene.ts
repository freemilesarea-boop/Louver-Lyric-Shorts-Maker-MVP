import type {
  FrameStyle,
  LanguageCode,
  LyricLine,
  MotionPreset,
  PlayIconStyle,
  ShadowStyle,
  Template,
} from './types';
import { LANGUAGE_FONT_STACK } from './lang';
import { drawImageWithMotion, isStaticMotion, motionAt } from './motion';
import { REST_STATE, type AnimationState } from './animation';

/** Canonical export resolution. All layout math is computed against this size
 * and scaled for the live preview by passing width/height to the same code. */
export const SCENE_W = 1080;
export const SCENE_H = 1920;

export interface ResolvedColors {
  en: string;
  ko: string;
  shadow: string;
  glow: string;
  frame: string;
}

export interface FontSpec {
  family: string;
  sizeEN: number; // pixels at SCENE_W=1080
  sizeKO: number;
  weight: number;
  letterSpacing: number;
}

export interface ShadowSpec {
  offsetX: number;
  offsetY: number;
  blur: number;
  color: string;
  /** True for outline-style: stroke text instead of fill+shadow. */
  outline?: boolean;
}

export interface PhotoBox {
  /** All values in canonical (1080x1920) coordinate space. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameSpec {
  style: FrameStyle;
  /** Padding (canonical px) around the photo before the frame edge. */
  padding: number;
  color: string;
  glowColor?: string;
}

export type LyricPositioning = {
  yEN: number;
  yKO: number;
  xAnchor: number;
  align: CanvasTextAlign;
  maxWidth: number;
};

export function resolveColors(t: Template, highlightSub: boolean): ResolvedColors {
  return {
    en: t.lyricColor,
    ko: highlightSub ? t.lyricSubColor : t.lyricColor,
    shadow: 'rgba(0,0,0,0.55)',
    glow: t.glowColor ?? t.lyricSubColor,
    frame: t.frameColor ?? '#FFFFFF',
  };
}

export function resolveFontSpec(t: Template, lang: LanguageCode): FontSpec {
  const base = t.fontStack?.byLang?.[lang] ?? t.fontStack?.base ?? t.fontFamily;
  const langFallback = LANGUAGE_FONT_STACK[lang];
  const family = `${base}, ${langFallback}`;
  return {
    family,
    sizeEN: t.fontSize,
    sizeKO: Math.round(t.fontSize * 0.78),
    weight: t.fontWeight,
    // Tighter tracking for huge display type, looser for compact text.
    letterSpacing: t.fontSize >= 60 ? -1 : 0,
  };
}

export function resolveShadow(t: Template): ShadowSpec {
  switch (t.shadowStyle ?? 'soft') {
    case 'none':
      return { offsetX: 0, offsetY: 0, blur: 0, color: 'rgba(0,0,0,0)' };
    case 'hard':
      return { offsetX: 3, offsetY: 4, blur: 0, color: 'rgba(0,0,0,0.7)' };
    case 'glow':
      return {
        offsetX: 0,
        offsetY: 0,
        blur: 24,
        color: t.glowColor ?? t.lyricSubColor,
      };
    case 'outline':
      return { offsetX: 0, offsetY: 0, blur: 0, color: 'rgba(0,0,0,0.85)', outline: true };
    case 'soft':
    default:
      return { offsetX: 2, offsetY: 3, blur: 6, color: 'rgba(0,0,0,0.55)' };
  }
}

export function resolvePhotoBox(_t: Template): PhotoBox {
  // Canonical centered card; templates can shift this in future versions.
  const width = Math.round(SCENE_W * 0.86);
  const height = Math.round(SCENE_H * 0.62);
  const x = (SCENE_W - width) / 2;
  const y = (SCENE_H - height) / 2 - 80;
  return { x, y, width, height };
}

export function resolveFrame(t: Template): FrameSpec {
  return {
    style: t.frameStyle ?? 'none',
    padding: Math.round(SCENE_W * (t.framePadding ?? 0.0)),
    color: t.frameColor ?? '#FFFFFF',
    glowColor: t.glowColor,
  };
}

export function resolveLyricPositioning(t: Template): LyricPositioning {
  const yBase = (() => {
    switch (t.lyricPosition) {
      case 'top':
        return Math.round(SCENE_H * 0.12);
      case 'center':
        return Math.round(SCENE_H * 0.66);
      case 'bottom':
      default:
        return Math.round(SCENE_H * 0.78);
    }
  })();

  const xAnchor = (() => {
    switch (t.lyricAlign) {
      case 'left':
        return 80;
      case 'right':
        return SCENE_W - 80;
      case 'center':
      default:
        return SCENE_W / 2;
    }
  })();

  const align: CanvasTextAlign =
    t.lyricAlign === 'left' ? 'left' : t.lyricAlign === 'right' ? 'right' : 'center';

  return {
    yEN: yBase,
    yKO: yBase + Math.round(t.fontSize * 1.5),
    xAnchor,
    align,
    maxWidth: Math.round(SCENE_W * 0.9),
  };
}

/* ------------------------------- canvas painters ------------------------------- */

export interface RenderSceneOpts {
  width: number;
  height: number;
  template: Template;
  language: LanguageCode;
  highlightSub: boolean;
  /** When true, the canvas should remain transparent except for overlay layers
   *  — used for export PNG generation. When false, paint full preview. */
  exportMode: boolean;
  /** The current lyric line (one chunk). */
  lyric?: LyricLine | null;
  trackTitle?: string;
  artistName?: string;
  /** For preview only — the source photo as an HTMLImageElement. */
  photo?: HTMLImageElement | null;
  /** Used in preview for animated chrome (progress, waveform). 0..1. */
  timeRatio?: number;
  /** Active photo motion preset (preview only). Defaults to template default. */
  motionPreset?: MotionPreset;
  /** Animation state to apply when painting the lyric line (and meta). */
  animation?: AnimationState;
}

export function renderScene(ctx: CanvasRenderingContext2D, o: RenderSceneOpts): void {
  const sx = o.width / SCENE_W;
  const sy = o.height / SCENE_H;
  const t = o.template;
  ctx.save();
  ctx.scale(sx, sy);

  // 1) Background — preview only.
  if (!o.exportMode) {
    paintBackground(ctx, o);
  }

  // 2) Foreground photo card — preview only (export defers to ffmpeg).
  const photoBox = resolvePhotoBox(t);
  if (!o.exportMode) {
    paintForegroundCard(ctx, o, photoBox);
  }

  // 3) Frame decorations — both modes (export needs to overlay them).
  paintFrame(ctx, o, photoBox);

  // 4) Lyric text — both modes.
  if (o.lyric) {
    paintLyric(ctx, o, photoBox);
  }

  // 5) Track meta — both modes.
  if (o.trackTitle || o.artistName) {
    paintMeta(ctx, o);
  }

  // 6) Chrome (progress / play icon / waveform / decorations).
  if (!o.exportMode) {
    paintChrome(ctx, o);
  } else {
    // Export adds only static decorations; ffmpeg drawbox handles animated chrome.
    paintDecorations(ctx, o);
  }

  ctx.restore();
}

/* --------- preview-only painters --------- */

function paintBackground(ctx: CanvasRenderingContext2D, o: RenderSceneOpts): void {
  const t = o.template;
  // Solid card bg as the floor.
  ctx.fillStyle = t.cardBg;
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);

  if (o.photo) {
    const cover = fitCover(o.photo.width, o.photo.height, SCENE_W, SCENE_H);
    ctx.save();
    // Approximate ffmpeg's effect chain.
    const cssFilter = (() => {
      switch (t.backgroundEffect) {
        case 'blur':
          return 'blur(40px) brightness(0.95) saturate(1.05)';
        case 'darken':
          return 'blur(16px) brightness(0.55) saturate(0.95)';
        case 'sepia':
          return 'blur(24px) sepia(1) brightness(0.95) saturate(0.6)';
        case 'none':
        default:
          return 'blur(8px)';
      }
    })();
    // ctx.filter is only widely supported, but Electron's Chromium has it.
    (ctx as CanvasRenderingContext2D & { filter: string }).filter = cssFilter;
    ctx.drawImage(o.photo, cover.x, cover.y, cover.w, cover.h);
    (ctx as CanvasRenderingContext2D & { filter: string }).filter = 'none';
    ctx.restore();
  }

  // Tint overlay.
  if (t.overlayOpacity > 0) {
    ctx.fillStyle = withAlpha(t.cardBg, t.overlayOpacity * 0.25);
    ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  }
}

function paintForegroundCard(
  ctx: CanvasRenderingContext2D,
  o: RenderSceneOpts,
  box: PhotoBox,
): void {
  if (!o.photo) return;
  const preset = o.motionPreset ?? o.template.motionPreset ?? 'none';

  if (isStaticMotion(preset)) {
    // Static-only path keeps the legacy fit-contain framing so a photo with
    // an unusual aspect ratio is shown in full (with implicit letterboxing
    // against the card background). This matches the pre-motion behavior.
    const fit = fitContain(o.photo.width, o.photo.height, box.width, box.height);
    ctx.drawImage(o.photo, box.x + fit.x, box.y + fit.y, fit.w, fit.h);
    return;
  }

  // Motion path: cover-crop the photo to the card aspect ratio so the
  // zoom/pan window always has full-frame content (no letterboxing) and
  // matches what ffmpeg's zoompan output looks like.
  const ratio = o.timeRatio ?? 0;
  const motion = motionAt(preset, ratio);
  drawImageWithMotion(ctx, o.photo, box.x, box.y, box.width, box.height, motion);
}

function paintChrome(ctx: CanvasRenderingContext2D, o: RenderSceneOpts): void {
  const t = o.template;
  const ratio = Math.max(0, Math.min(1, o.timeRatio ?? 0));

  // Progress bar.
  if (t.progressBarStyle !== 'none') {
    const margin = 80;
    const fullW = SCENE_W - margin * 2;
    const barH = t.progressBarStyle === 'thick' ? 10 : 6;
    const barY = Math.round(SCENE_H * 0.88);
    const radius = t.progressBarStyle === 'rounded' ? barH / 2 : 2;
    ctx.fillStyle = withAlpha(t.lyricColor, 0.25);
    roundedRect(ctx, margin, barY, fullW, barH, radius);
    ctx.fillStyle = withAlpha(t.lyricColor, 0.95);
    roundedRect(ctx, margin, barY, fullW * ratio, barH, radius);
  }

  // Play icon.
  if (t.showPlayerControl) {
    paintPlayIcon(ctx, t.playIconStyle ?? 'triangle', t.lyricColor);
  }

  // Faux waveform.
  if (t.showWaveform) {
    paintWaveform(ctx, t.lyricColor, ratio);
  }

  paintDecorations(ctx, o);
}

function paintDecorations(ctx: CanvasRenderingContext2D, o: RenderSceneOpts): void {
  const t = o.template;
  const dec = t.decoration ?? 'none';
  if (dec === 'scanlines') {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000000';
    for (let y = 0; y < SCENE_H; y += 4) {
      ctx.fillRect(0, y, SCENE_W, 1);
    }
    ctx.restore();
  } else if (dec === 'grain') {
    ctx.save();
    ctx.globalAlpha = 0.06;
    for (let i = 0; i < 800; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#000000';
      ctx.fillRect(
        Math.floor(Math.random() * SCENE_W),
        Math.floor(Math.random() * SCENE_H),
        2,
        2,
      );
    }
    ctx.restore();
  } else if (dec === 'sparkles') {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = withAlpha(t.lyricSubColor, 0.85);
    for (let i = 0; i < 28; i++) {
      const cx = ((i * 113) % SCENE_W);
      const cy = ((i * 271) % SCENE_H);
      const r = 3 + ((i * 7) % 6);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else if (dec === 'reels') {
    // Two cassette-style reel circles drawn near the photo edges.
    const photo = resolvePhotoBox(t);
    ctx.save();
    ctx.fillStyle = withAlpha(t.frameColor ?? '#222', 0.95);
    [
      { cx: photo.x + 90, cy: photo.y + photo.height + 60 },
      { cx: photo.x + photo.width - 90, cy: photo.y + photo.height + 60 },
    ].forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, 60, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = withAlpha('#000000', 0.6);
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = withAlpha(t.frameColor ?? '#222', 0.95);
    });
    ctx.restore();
  }
}

/* --------- both-mode painters --------- */

function paintFrame(
  ctx: CanvasRenderingContext2D,
  o: RenderSceneOpts,
  box: PhotoBox,
): void {
  const t = o.template;
  const frame = resolveFrame(t);
  if (frame.style === 'none') return;

  switch (frame.style) {
    case 'polaroid': {
      const pad = Math.max(28, frame.padding || 28);
      const bottomPad = pad * 4;
      // Drop shadow under the polaroid.
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 14;
      ctx.fillStyle = frame.color;
      ctx.fillRect(box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad + bottomPad);
      ctx.restore();
      break;
    }
    case 'rounded': {
      const r = 36;
      ctx.save();
      ctx.fillStyle = frame.color;
      roundedRect(ctx, box.x - 8, box.y - 8, box.width + 16, box.height + 16, r);
      ctx.restore();
      break;
    }
    case 'circle': {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const r = Math.min(box.width, box.height) / 2 + 16;
      ctx.save();
      ctx.fillStyle = frame.color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'cassette': {
      // Outer cassette body.
      const pad = 60;
      ctx.save();
      ctx.fillStyle = frame.color;
      roundedRect(ctx, box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2, 30);
      // Inner label window where the photo sits — drawn with a darker stroke.
      ctx.strokeStyle = withAlpha('#000000', 0.6);
      ctx.lineWidth = 6;
      ctx.strokeRect(box.x - 4, box.y - 4, box.width + 8, box.height + 8);
      ctx.restore();
      break;
    }
    case 'vinyl': {
      // Big black record under the photo, photo as label.
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const r = Math.min(box.width, box.height) * 0.7;
      ctx.save();
      ctx.fillStyle = '#0a0a0c';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha('#ffffff', 0.06);
      ctx.lineWidth = 2;
      for (let rr = r - 30; rr > r * 0.4; rr -= 18) {
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'photo': {
      ctx.save();
      ctx.strokeStyle = frame.color;
      ctx.lineWidth = 12;
      ctx.strokeRect(box.x - 6, box.y - 6, box.width + 12, box.height + 12);
      ctx.restore();
      break;
    }
    case 'neon-border': {
      const glow = frame.glowColor ?? '#FF00C8';
      ctx.save();
      ctx.shadowColor = glow;
      ctx.shadowBlur = 36;
      ctx.strokeStyle = glow;
      ctx.lineWidth = 6;
      ctx.strokeRect(box.x - 6, box.y - 6, box.width + 12, box.height + 12);
      ctx.shadowBlur = 60;
      ctx.strokeStyle = withAlpha(glow, 0.6);
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x - 14, box.y - 14, box.width + 28, box.height + 28);
      ctx.restore();
      break;
    }
  }
}

function paintLyric(
  ctx: CanvasRenderingContext2D,
  o: RenderSceneOpts,
  _box: PhotoBox,
): void {
  if (!o.lyric) return;
  const t = o.template;
  const colors = resolveColors(t, o.highlightSub);
  const font = resolveFontSpec(t, o.language);
  const baseShadow = resolveShadow(t);
  const pos = resolveLyricPositioning(t);
  const anim = o.animation ?? REST_STATE;

  // Skip painting once the line is fully invisible.
  if (anim.opacity <= 0.001) return;

  // Glow strengthens the lyric's drop shadow with the sub-color, additive.
  const shadow =
    anim.glow > 0
      ? {
          ...baseShadow,
          color: withAlpha(t.glowColor ?? t.lyricSubColor, 0.55 + anim.glow * 0.45),
          blur: Math.max(baseShadow.blur, 18 + anim.glow * 36),
          offsetX: 0,
          offsetY: 0,
        }
      : baseShadow;

  ctx.save();
  ctx.globalAlpha *= clamp01(anim.opacity);
  if (anim.blur > 0) {
    setCanvasFilter(ctx, `blur(${anim.blur.toFixed(1)}px)`);
  }
  // Scale & translate around the lyric's vertical anchor so the motion
  // pivots from the line's natural position.
  const pivotY = pos.yEN + Math.round(font.sizeEN * 0.5);
  ctx.translate(pos.xAnchor, pivotY);
  if (anim.scale !== 1) ctx.scale(anim.scale, anim.scale);
  if (anim.translateY !== 0) ctx.translate(0, anim.translateY);
  ctx.translate(-pos.xAnchor, -pivotY);

  ctx.textAlign = pos.align;
  ctx.textBaseline = 'middle';

  if (o.lyric.text && o.lyric.text.trim()) {
    paintTextLines(ctx, {
      text: o.lyric.text,
      x: pos.xAnchor,
      y: pos.yEN,
      maxWidth: pos.maxWidth,
      fontSize: font.sizeEN,
      fontWeight: font.weight,
      family: font.family,
      color: colors.en,
      shadow,
    });
  }
  if (o.lyric.ko && o.lyric.ko.trim()) {
    paintTextLines(ctx, {
      text: o.lyric.ko,
      x: pos.xAnchor,
      y: pos.yKO,
      maxWidth: pos.maxWidth,
      fontSize: font.sizeKO,
      fontWeight: 500,
      family: font.family,
      color: colors.ko,
      shadow,
    });
  }
  ctx.restore();
}

function paintMeta(ctx: CanvasRenderingContext2D, o: RenderSceneOpts): void {
  const t = o.template;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = SCENE_W / 2;
  const yTitle = Math.round(SCENE_H * 0.78);

  if (o.trackTitle && o.trackTitle.trim()) {
    paintTextLines(ctx, {
      text: o.trackTitle,
      x: cx,
      y: yTitle,
      maxWidth: SCENE_W * 0.9,
      fontSize: 38,
      fontWeight: 700,
      family: resolveFontSpec(t, o.language).family,
      color: t.lyricColor,
      shadow: resolveShadow(t),
    });
  }
  if (o.artistName && o.artistName.trim()) {
    paintTextLines(ctx, {
      text: o.artistName,
      x: cx,
      y: yTitle + 50,
      maxWidth: SCENE_W * 0.9,
      fontSize: 28,
      fontWeight: 500,
      family: resolveFontSpec(t, o.language).family,
      color: withAlpha(t.lyricColor, 0.7),
      shadow: resolveShadow(t),
    });
  }
  ctx.restore();
}

function paintPlayIcon(
  ctx: CanvasRenderingContext2D,
  style: PlayIconStyle,
  color: string,
): void {
  if (style === 'none') return;
  const cx = SCENE_W / 2;
  const cy = Math.round(SCENE_H * 0.93);
  ctx.save();
  if (style === 'rounded') {
    ctx.fillStyle = withAlpha(color, 0.18);
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = color;
  if (style === 'minimal') {
    ctx.fillRect(cx - 10, cy - 14, 6, 28);
    ctx.fillRect(cx + 4, cy - 14, 6, 28);
  } else {
    // Triangle (default + rounded share triangle face).
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy - 14);
    ctx.lineTo(cx + 13, cy);
    ctx.lineTo(cx - 9, cy + 14);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function paintWaveform(ctx: CanvasRenderingContext2D, color: string, ratio: number): void {
  const bars = 32;
  const margin = 100;
  const baseY = Math.round(SCENE_H * 0.84);
  const region = SCENE_W - margin * 2;
  const slot = Math.floor(region / bars);
  ctx.save();
  for (let i = 0; i < bars; i++) {
    const seed = (i * 37) % 100;
    const phase = ratio * Math.PI * 4 + i * 0.7;
    const h = Math.max(12, Math.min(80, (seed / 100) * 40 + 30 + 20 * Math.sin(phase)));
    const x = margin + i * slot;
    ctx.fillStyle = withAlpha(color, 0.85);
    ctx.fillRect(x, baseY - h / 2, Math.max(2, slot - 4), h);
  }
  ctx.restore();
}

/* ------------------------------ text + helpers ------------------------------ */

interface TextOpts {
  text: string;
  x: number;
  y: number;
  maxWidth: number;
  fontSize: number;
  fontWeight: number;
  family: string;
  color: string;
  shadow: ShadowSpec;
}

export function paintTextLines(ctx: CanvasRenderingContext2D, p: TextOpts): void {
  ctx.font = `${p.fontWeight} ${p.fontSize}px ${p.family}`;
  const lines = wrapText(ctx, p.text, p.maxWidth);
  const lineHeight = Math.round(p.fontSize * 1.18);
  const totalH = lines.length * lineHeight;
  let y = p.y - totalH / 2 + lineHeight / 2;

  ctx.save();
  if (p.shadow.outline) {
    // Outline mode: draw stroke under fill.
    for (const ln of lines) {
      ctx.strokeStyle = p.shadow.color;
      ctx.lineWidth = Math.max(2, Math.round(p.fontSize * 0.05));
      ctx.lineJoin = 'round';
      ctx.strokeText(ln, p.x, y);
      ctx.fillStyle = p.color;
      ctx.fillText(ln, p.x, y);
      y += lineHeight;
    }
  } else {
    ctx.shadowColor = p.shadow.color;
    ctx.shadowBlur = p.shadow.blur;
    ctx.shadowOffsetX = p.shadow.offsetX;
    ctx.shadowOffsetY = p.shadow.offsetY;
    ctx.fillStyle = p.color;
    for (const ln of lines) {
      ctx.fillText(ln, p.x, y);
      y += lineHeight;
    }
  }
  ctx.restore();
}

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
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
  // For CJK without spaces, fallback character-wise wrapping if any line still
  // exceeds maxWidth.
  const out: string[] = [];
  for (const ln of lines) {
    if (ctx.measureText(ln).width <= maxWidth) {
      out.push(ln);
      continue;
    }
    let buf = '';
    for (const ch of ln) {
      if (ctx.measureText(buf + ch).width > maxWidth && buf.length > 0) {
        out.push(buf);
        buf = ch;
      } else {
        buf += ch;
      }
    }
    if (buf) out.push(buf);
  }
  return out;
}

function setCanvasFilter(ctx: CanvasRenderingContext2D, value: string): void {
  // ctx.filter is supported by Chromium, which is what Electron renders with.
  // Cast through unknown for environments where the lib lacks the property.
  (ctx as unknown as { filter: string }).filter = value;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function fitContain(srcW: number, srcH: number, dstW: number, dstH: number) {
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

function fitCover(srcW: number, srcH: number, dstW: number, dstH: number) {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
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

function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  if (color.startsWith('rgba(') || color.startsWith('rgb(')) {
    // Already rgba/rgb — replace alpha.
    const m = color.match(/^rgba?\(([^)]+)\)$/);
    if (!m) return color;
    const parts = m[1].split(',').map((s) => s.trim());
    const [r, g, b] = parts;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  const cleaned = color.startsWith('#') ? color.slice(1) : color;
  if (cleaned.length !== 6) return color;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

