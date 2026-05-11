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
import { FONTS, defaultFontForLanguage, fontFamilyFor, type FontKey } from './fonts';
import { REST_STATE, type AnimationState } from './animation';
import { REST_REACTIVE, type ReactiveState } from './audioReactive';
import { type FxConfig, paintCinematicFx } from './cinematicFx';
import { paintKaraokeText, splitTokens } from './karaoke';
import { paintWatermark, type WatermarkConfig } from './watermark';
import { paintPlayerChrome } from './playerChrome';

/** Canonical export resolution. All layout math is computed against this size
 * and scaled for the live preview by passing width/height to the same code. */
export const SCENE_W = 1080;
export const SCENE_H = 1920;

/** Anything drawImage can paint that also exposes width/height for
 *  fit-contain calculations. HTMLVideoElement only has meaningful
 *  width/height once we copy videoWidth/videoHeight onto it (see
 *  LivePreview's video loader). */
export type ScenePhoto =
  | HTMLImageElement
  | HTMLVideoElement
  | HTMLCanvasElement
  | ImageBitmap;

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

export function resolveColors(
  t: Template,
  highlightSub: boolean,
  /** Optional user overrides. Each field is independently optional so
   *  the user can set just one (e.g. main border color) without
   *  changing the whole template. */
  overrides?: import('./types').StyleOverrides | null,
): ResolvedColors {
  const enColor = overrides?.lyricPrimaryColor ?? t.lyricColor;
  const subColor = overrides?.lyricSecondaryColor ?? t.lyricSubColor;
  return {
    en: enColor,
    ko: highlightSub ? subColor : enColor,
    shadow: 'rgba(0,0,0,0.55)',
    glow: t.glowColor ?? subColor,
    frame: overrides?.mainBorderColor ?? t.frameColor ?? '#FFFFFF',
  };
}

export function resolveFontSpec(
  t: Template,
  lang: LanguageCode,
  /** User pick from FontSelector. Wins over template's fontStack/fontFamily.
   *  Null/undefined → fall back to the template's declared family chain. */
  fontKeyOverride?: FontKey | null,
  /** Multiplicative scale applied to both en + ko sizes (0.75..1.5).
   *  1 = template default. */
  fontScale: number = 1,
): FontSpec {
  // The single source of truth for the font feature: when the user picks
  // (or we resolve a per-language default), `fontFamilyFor()` builds a
  // CSS family list with the canonical name first and the fallback chain
  // appended. The same string drives ctx.font in canvas (live preview +
  // export bake) — no separate ffmpeg drawtext path; see fonts.ts header.
  const family = fontKeyOverride
    ? fontFamilyFor(fontKeyOverride)
    : (() => {
        const base = t.fontStack?.byLang?.[lang] ?? t.fontStack?.base ?? t.fontFamily;
        const langFallback = LANGUAGE_FONT_STACK[lang];
        return `${base}, ${langFallback}`;
      })();
  const safeScale = Math.max(0.75, Math.min(1.5, fontScale));
  return {
    family,
    sizeEN: Math.round(t.fontSize * safeScale),
    sizeKO: Math.round(t.fontSize * 0.78 * safeScale),
    weight: t.fontWeight,
    // Tighter tracking for huge display type, looser for compact text.
    letterSpacing: t.fontSize >= 60 ? -1 : 0,
  };
}

// Force-reference exports kept for tooling consumers that want the
// per-language default lookup outside scene.ts.
void FONTS;
void defaultFontForLanguage;

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

/**
 * Apply a user-picked lyric visual effect on top of the template's base
 * shadow. The result is consumed by paintTextLines / paintKaraokeText and
 * may further be widened by reactive/animation glow in paintLyric.
 *
 * Effects are tuned to be obvious enough to register at glance but not
 * loud enough to crush legibility:
 *  - none: explicitly disable the shadow (override even the template's)
 *  - soft_shadow: keep the template default
 *  - neon: blur in the primary color (sign-tube look)
 *  - glow: bigger softer blur in primary
 *  - outline: stroke under fill, no blur
 *  - subtle_blur_glow: low-alpha secondary tint, mild blur
 */
function applyLyricEffect(
  base: ShadowSpec,
  effect: import('./types').LyricEffect,
  colors: { primary: string; secondary: string },
): ShadowSpec {
  switch (effect) {
    case 'none':
      return { offsetX: 0, offsetY: 0, blur: 0, color: 'rgba(0,0,0,0)' };
    case 'neon':
      return {
        offsetX: 0,
        offsetY: 0,
        blur: 26,
        color: withAlpha(colors.primary, 0.85),
      };
    case 'glow':
      return {
        offsetX: 0,
        offsetY: 0,
        blur: 38,
        color: withAlpha(colors.primary, 0.65),
      };
    case 'outline':
      return {
        offsetX: 0,
        offsetY: 0,
        blur: 0,
        color: 'rgba(0,0,0,0.85)',
        outline: true,
      };
    case 'subtle_blur_glow':
      return {
        offsetX: 0,
        offsetY: 0,
        blur: 14,
        color: withAlpha(colors.secondary, 0.45),
      };
    case 'soft_shadow':
    default:
      return base;
  }
}

export function resolvePhotoBox(
  _t: Template,
  /** Optional user scale (0.6..1.2). 1 = template default. Lets the user
   *  shrink/grow the foreground photo without touching the template. */
  scale: number = 1,
): PhotoBox {
  // Photo dominates the frame (was 86%×62% — left big cardBg margins that
  // washed out the upload). 92%×74% keeps lyric room at bottom while
  // letting the user's image be the visual anchor.
  const safeScale = Math.max(0.6, Math.min(1.2, scale));
  const width = Math.round(SCENE_W * 0.92 * safeScale);
  const height = Math.round(SCENE_H * 0.74 * safeScale);
  const x = (SCENE_W - width) / 2;
  const y = (SCENE_H - height) / 2 - 100;
  return { x, y, width, height };
}

/**
 * Phase 5-7 — resolve which optional UI layers (player chrome /
 * progress bar / waveform) actually render for this scene. The user's
 * StyleOverrides win when set; otherwise we follow the template
 * defaults. Both `paintChrome` (preview + bake) and the ffmpeg filter
 * graph read this so preview ↔ export stay in lockstep.
 */
export interface EffectiveDisplay {
  showWaveform: boolean;
  /** True when the template ships a player-chrome painter (apple-like
   *  / spotify-like / youtube-like) AND the user hasn't hidden it. */
  showPlayerChrome: boolean;
  /** True when there's any progress bar to draw. Tied to player chrome
   *  visibility (hiding the chrome also hides the progress bar) so the
   *  toggle reads as a single "재생 플레이어 표시" knob. */
  showProgressBar: boolean;
}

export function resolveDisplay(
  t: Template,
  overrides?: import('./types').StyleOverrides | null,
): EffectiveDisplay {
  const playerVis =
    overrides?.showPlayerChrome ?? (t.playerChrome != null || t.progressBarStyle !== 'none');
  return {
    showWaveform: overrides?.showWaveform ?? t.showWaveform,
    showPlayerChrome: playerVis && t.playerChrome != null,
    showProgressBar: playerVis && t.progressBarStyle !== 'none',
  };
}

export function resolveFrame(
  t: Template,
  overrides?: import('./types').StyleOverrides | null,
): FrameSpec {
  return {
    style: t.frameStyle ?? 'none',
    padding: Math.round(SCENE_W * (t.framePadding ?? 0.0)),
    color: overrides?.mainBorderColor ?? t.frameColor ?? '#FFFFFF',
    glowColor: t.glowColor,
  };
}

export function resolveLyricPositioning(
  t: Template,
  /** Optional user override (auto-safe-position suggester) — wins over
   *  the template's own lyricPosition when set. */
  override?: Template['lyricPosition'] | null,
  /** Phase 5-5 user drag — wins over both template default AND the
   *  symbolic position override. When set, uses the absolute (x,y) the
   *  user dragged the lyric to. Otherwise we fall through to the legacy
   *  symbolic positioning. */
  draggedTo?: { x: number; y: number } | null,
): LyricPositioning {
  // Drag wins. The user has explicit pixel-precise placement; respect it.
  if (draggedTo) {
    const align: CanvasTextAlign =
      t.lyricAlign === 'left' ? 'left' : t.lyricAlign === 'right' ? 'right' : 'center';
    return {
      yEN: Math.round(draggedTo.y),
      yKO: Math.round(draggedTo.y + t.fontSize * 1.5),
      xAnchor: Math.round(draggedTo.x),
      align,
      maxWidth: Math.round(SCENE_W * 0.9),
    };
  }

  const effective = override ?? t.lyricPosition;
  const yBase = (() => {
    switch (effective) {
      case 'top':
        return Math.round(SCENE_H * 0.12);
      case 'center':
        return Math.round(SCENE_H * 0.66);
      case 'lower_center':
        return Math.round(SCENE_H * 0.69);
      case 'bottom_safe':
        return Math.round(SCENE_H * 0.72);
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
  /** For preview only — the main photo source. HTMLImageElement for
   *  still / GIF, HTMLVideoElement for video kind (Phase 5-6.1). Both
   *  are CanvasImageSource and expose `.width/.height` (we set
   *  width=videoWidth on the video at metadata-load time). */
  photo?: ScenePhoto | null;
  /** Optional separate background image. When set, drawn cover-cropped +
   *  blurred behind the foreground. When null, `photo` doubles as the
   *  background (legacy behavior). */
  backgroundPhoto?: ScenePhoto | null;
  /** User style tweaks applied on top of template defaults. */
  styleOverrides?: import('./types').StyleOverrides | null;
  /** Per-element drag positions (canonical 1080×1920). When set, the
   *  matching painter uses these coordinates instead of the template's
   *  default position. Each field is independently optional. */
  layoutOverrides?: import('./types').LayoutOverrides | null;
  /** Pre-computed amplitude curve. Drives the per-bar waveform window
   *  in paintWaveform. When null, the waveform falls back to the legacy
   *  sin animation. */
  amplitudeCurve?: import('./types').AmplitudeCurve | null;
  /** Current playback time within the clip (seconds). Drives the
   *  waveform's center-of-window sample. Phase 5-5 reuses LivePreview's
   *  tNowSec. Defaults to timeRatio × durationSec when unset. */
  tNowSec?: number;
  /** Used in preview for animated chrome (progress, waveform). 0..1. */
  timeRatio?: number;
  /** Active photo motion preset (preview only). Defaults to template default. */
  motionPreset?: MotionPreset;
  /** Animation state to apply when painting the lyric line (and meta). */
  animation?: AnimationState;
  /** Audio-reactive state — drives subtle vignette / glow / bloom layers. */
  reactive?: ReactiveState;
  /** Cinematic FX intensities — grain / vignette / aberration / bloom etc. */
  fxConfig?: FxConfig;
  /** Integer seed for the FX noise/dust positions (must agree across
   *  preview & export at the same moment for parity). */
  fxSeed?: number;
  /** Karaoke "lite" — when set, paint the active token (= floor(progress
   *  × wordCount)) with the template sub-color + glow. */
  karaoke?: {
    enabled: boolean;
    /** 0..1 — clip-relative progress through the current chunk. */
    progress: number;
  };
  /** User override of the template's lyric Y position (auto-safe-position
   *  suggester). When set, takes precedence over template.lyricPosition. */
  lyricPositionOverride?: Template['lyricPosition'] | null;
  /** User-picked font key. Wins over template font stack when set; null /
   *  undefined falls back to template defaults + per-language hinting. */
  fontKey?: FontKey | null;
  /** Watermark / branding overlay. Painted as the final scene step so it
   *  sits above lyrics, FX, and reactive layers. Null/undefined or
   *  enabled=false → no-op. For export, only the dedicated full-duration
   *  watermark overlay PNG carries this; per-line keyframe PNGs leave it
   *  null so the mark doesn't flicker between lyric chunks. */
  watermark?: WatermarkConfig | null;
  /** Total clip duration in seconds. Used by the player-style chrome
   *  painter to render the time row (current / total). Optional —
   *  templates without playerChrome don't need this. */
  durationSec?: number;
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
  const photoBox = resolvePhotoBox(t, o.styleOverrides?.mainScale ?? 1);
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

  // 6b) Player-style chrome (apple/spotify/youtube-like). Painted in BOTH
  //     modes so the music-app feel ships in the exported MP4, not just
  //     the preview. The card is mostly static (track line + progress bar
  //     position is amplitude-independent at the keyframe sample), so it
  //     bakes cleanly into the same per-line PNG overlays.
  const display = resolveDisplay(o.template, o.styleOverrides ?? null);
  if (o.template.playerChrome && display.showPlayerChrome) {
    const r = o.reactive;
    const liveAmp = r ? Math.max(r.pulse, r.waveformBoost) : null;
    const metaFontKeyOverride = (o.styleOverrides?.metaFontKey ?? null) as
      | FontKey
      | null;
    const metaFamily = metaFontKeyOverride
      ? resolveFontSpec(o.template, o.language, metaFontKeyOverride, 1).family
      : undefined;
    paintPlayerChrome(ctx, o.template.playerChrome, {
      ratio: Math.max(0, Math.min(1, o.timeRatio ?? 0)),
      durationSec: o.durationSec ?? 0,
      amplitude: liveAmp,
      trackTitle: o.trackTitle,
      artistName: o.artistName,
      template: o.template,
      metaColor: o.styleOverrides?.metaColor,
      metaFontFamily: metaFamily,
      metaScale: o.styleOverrides?.metaFontScale,
      // Export pipeline draws the progress bar via ffmpeg drawbox for
      // smooth per-frame motion (vs steppy keyframe-rate updates baked
      // into a PNG). Preview keeps painting it normally for the live
      // requestAnimationFrame loop.
      skipProgress: o.exportMode === true,
    });
  }

  // 7) Audio-reactive layers — render in BOTH modes so export PNG keyframes
  //    carry the bloom/vignette/glow that the preview shows.
  paintReactiveOverlay(ctx, o);

  // 8) Cinematic FX — final layer on top of everything (grain/vignette/etc).
  if (o.fxConfig) {
    paintCinematicFx(ctx, SCENE_W, SCENE_H, o.fxConfig, o.fxSeed ?? 0, o.template);
  }

  // 9) Watermark — sits above FX so the brand mark is never grain-covered.
  //    No-op unless o.watermark is set with enabled=true.
  if (o.watermark) {
    paintWatermark(ctx, SCENE_W, SCENE_H, o.watermark);
  }

  ctx.restore();
}

/* --------- preview-only painters --------- */

function paintBackground(ctx: CanvasRenderingContext2D, o: RenderSceneOpts): void {
  const t = o.template;
  // Solid card bg as the floor.
  ctx.fillStyle = t.cardBg;
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);

  // Background source: dedicated `backgroundPhoto` if the user picked one,
  // otherwise fall back to the main `photo` (legacy single-image behavior).
  const bgImage = o.backgroundPhoto ?? o.photo;
  if (bgImage) {
    const cover = fitCover(bgImage.width, bgImage.height, SCENE_W, SCENE_H);
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
    ctx.drawImage(bgImage, cover.x, cover.y, cover.w, cover.h);
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
  const display = resolveDisplay(t, o.styleOverrides ?? null);

  // Progress bar.
  if (display.showProgressBar) {
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

  // Reactive waveform — uses live amplitude when the curve is wired up.
  if (display.showWaveform) {
    // Phase 5-5: paintWaveform now takes the full amplitude curve when
    // available. Each bar samples a windowed offset around the current
    // playback time → real spectrum motion. The reactive state's
    // pulse/waveformBoost still flows in as the fallback live amplitude
    // when no curve is wired up.
    const r = o.reactive;
    const liveAmp = r ? Math.max(r.pulse, r.waveformBoost) : null;
    const tNow =
      o.tNowSec ?? (o.timeRatio != null ? o.timeRatio * (o.durationSec ?? 0) : 0);
    paintWaveform(
      ctx,
      t.lyricColor,
      ratio,
      liveAmp ?? null,
      o.layoutOverrides?.waveform ?? null,
      o.amplitudeCurve ?? null,
      tNow,
    );
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
  const frame = resolveFrame(t, o.styleOverrides ?? null);
  if (frame.style === 'none') return;

  switch (frame.style) {
    case 'polaroid': {
      // Phase 5-3.3: was a fillRect that covered the entire photo region
      // when the per-line keyframe PNG (transparent except for painters)
      // was overlaid. Now: thin stroke around the photo + a small
      // bottom band for the polaroid label feel. Photo is never hidden.
      const pad = 12;
      const bottomBand = 36;
      ctx.save();
      // Drop shadow under the photo edge.
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 8;
      ctx.strokeStyle = frame.color;
      ctx.lineWidth = pad;
      ctx.strokeRect(
        box.x - pad / 2,
        box.y - pad / 2,
        box.width + pad,
        box.height + pad,
      );
      ctx.restore();
      // Polaroid bottom label band — drawn outside the photo box, below it.
      ctx.save();
      ctx.fillStyle = frame.color;
      ctx.fillRect(
        box.x - pad,
        box.y + box.height + pad / 2,
        box.width + pad * 2,
        bottomBand,
      );
      ctx.restore();
      break;
    }
    case 'rounded': {
      // Phase 5-3.3: was a solid fill, which painted on top of the photo
      // (in preview mode after paintForegroundCard, in export mode where
      // the per-line PNG overlays the photo). Now: stroked outline only.
      const r = 36;
      ctx.save();
      ctx.strokeStyle = frame.color;
      ctx.lineWidth = 6;
      // Trace the outer border path with arcs (roundedRect helper fills,
      // we want stroke only — inline the path here).
      const x = box.x - 6;
      const y = box.y - 6;
      const w = box.width + 12;
      const h = box.height + 12;
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'circle': {
      // Phase 5-3.3: was a giant fill that covered the entire photo with
      // a solid disc. Now: thin stroked ring framing the photo. (No
      // shipped template uses this style today — kept for future.)
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const r = Math.min(box.width, box.height) / 2 + 8;
      ctx.save();
      ctx.strokeStyle = frame.color;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'cassette': {
      // Phase 5-3: full-body cassette card was 60px on every side and
      // dwarfed the photo. Now: thin double-border at the photo edge,
      // cassette feel comes from template colors + decoration='reels'
      // beneath the photo.
      ctx.save();
      ctx.strokeStyle = frame.color;
      ctx.lineWidth = 8;
      ctx.strokeRect(box.x - 4, box.y - 4, box.width + 8, box.height + 8);
      ctx.strokeStyle = withAlpha('#000000', 0.5);
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x - 12, box.y - 12, box.width + 24, box.height + 24);
      ctx.restore();
      break;
    }
    case 'vinyl': {
      // Phase 5-3: vinyl style is no longer used by any shipped template
      // (was an anti-cover offender — full-canvas black record). Painter
      // kept as a thin record-edge accent for any future use that wants
      // the vibe without hiding the photo.
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const r = Math.min(box.width, box.height) * 0.55;
      ctx.save();
      ctx.strokeStyle = withAlpha('#000000', 0.65);
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = withAlpha('#ffffff', 0.08);
      ctx.lineWidth = 1;
      for (let rr = r + 6; rr > r * 0.7; rr -= 14) {
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
      const reactiveGlow = o.reactive?.glow ?? 0;
      ctx.save();
      ctx.shadowColor = glow;
      ctx.shadowBlur = 36 + reactiveGlow * 40;
      ctx.strokeStyle = glow;
      ctx.lineWidth = 6 + reactiveGlow * 4;
      ctx.strokeRect(box.x - 6, box.y - 6, box.width + 12, box.height + 12);
      ctx.shadowBlur = 60 + reactiveGlow * 50;
      ctx.strokeStyle = withAlpha(glow, 0.6 + reactiveGlow * 0.3);
      ctx.lineWidth = 2 + reactiveGlow * 2;
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
  const colors = resolveColors(t, o.highlightSub, o.styleOverrides ?? null);
  const font = resolveFontSpec(
    t,
    o.language,
    o.fontKey ?? null,
    o.styleOverrides?.lyricFontScale ?? 1,
  );
  const baseShadow = resolveShadow(t);
  const pos = resolveLyricPositioning(
    t,
    o.lyricPositionOverride ?? null,
    o.layoutOverrides?.lyric ?? null,
  );
  const anim = o.animation ?? REST_STATE;
  const reactive = o.reactive ?? REST_REACTIVE;

  // Skip painting once the line is fully invisible.
  if (anim.opacity <= 0.001) return;

  // Combine animation-driven glow with audio-reactive glow (additive, capped).
  const totalGlow = clamp01(anim.glow + reactive.glow);

  // Layer order: template baseShadow → lyricEffect override (if user picked
  // one) → reactive/animation glow widens blur on top. Effect's color
  // persists through reactive glow so the chosen vibe stays consistent.
  const effect = o.styleOverrides?.lyricEffect ?? 'soft_shadow';
  const effectShadow = applyLyricEffect(baseShadow, effect, {
    primary: colors.en,
    secondary: colors.ko,
  });
  const shadow =
    totalGlow > 0 && !effectShadow.outline
      ? {
          ...effectShadow,
          blur: Math.max(effectShadow.blur, 18 + totalGlow * 40),
          offsetX: 0,
          offsetY: 0,
        }
      : effectShadow;

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

  // Karaoke toggle picks the per-token painter; otherwise stay on the
  // legacy single-color line painter.
  const karaokeOn = o.karaoke?.enabled === true;
  const progress = o.karaoke?.progress ?? 0;
  const glowAmount = clamp01(anim.glow + reactive.glow);

  if (o.lyric.text && o.lyric.text.trim()) {
    if (karaokeOn) {
      paintKaraokeText(ctx, {
        text: o.lyric.text,
        x: pos.xAnchor,
        y: pos.yEN,
        maxWidth: pos.maxWidth,
        fontSize: font.sizeEN,
        fontWeight: font.weight,
        family: font.family,
        baseColor: colors.en,
        activeColor: t.lyricSubColor,
        glowColor: t.glowColor ?? t.lyricSubColor,
        glowAmount,
        shadow,
        progress,
        textAlign: pos.align,
      });
    } else {
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
  }
  if (o.lyric.ko && o.lyric.ko.trim()) {
    if (karaokeOn) {
      paintKaraokeText(ctx, {
        text: o.lyric.ko,
        x: pos.xAnchor,
        y: pos.yKO,
        maxWidth: pos.maxWidth,
        fontSize: font.sizeKO,
        fontWeight: 500,
        family: font.family,
        baseColor: colors.ko,
        activeColor: t.lyricSubColor,
        glowColor: t.glowColor ?? t.lyricSubColor,
        glowAmount,
        shadow,
        progress,
        textAlign: pos.align,
      });
    } else {
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
  }
  ctx.restore();
}

/** Combined word count across en + ko (used by overlays.ts to size the
 *  hold-phase keyframe subdivision when karaoke is on). */
export function lyricWordCount(line: { text?: string; ko?: string }): number {
  return splitTokens(line.text ?? '').length + splitTokens(line.ko ?? '').length;
}

function paintMeta(ctx: CanvasRenderingContext2D, o: RenderSceneOpts): void {
  const t = o.template;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Default centered; user drag wins via layoutOverrides.meta.
  const dragged = o.layoutOverrides?.meta;
  const cx = dragged ? Math.round(dragged.x) : SCENE_W / 2;
  const yTitle = dragged ? Math.round(dragged.y) : Math.round(SCENE_H * 0.78);
  // Phase 5-4: meta has its own font / color / scale overrides so users
  // can tune track-info typography independently of lyric typography.
  // Falls back to the lyric font key when metaFontKey is unset.
  const metaScale = o.styleOverrides?.metaFontScale ?? 1;
  const metaSafeScale = Math.max(0.75, Math.min(1.5, metaScale));
  const metaFontKey = (o.styleOverrides?.metaFontKey ?? o.fontKey ?? null) as
    | FontKey
    | null;
  const metaFamily = resolveFontSpec(t, o.language, metaFontKey, 1).family;
  const titleColor = o.styleOverrides?.metaColor ?? t.lyricColor;
  const artistColor =
    o.styleOverrides?.metaColor != null
      ? withAlpha(o.styleOverrides.metaColor, 0.78)
      : withAlpha(t.lyricColor, 0.7);

  if (o.trackTitle && o.trackTitle.trim()) {
    paintTextLines(ctx, {
      text: o.trackTitle,
      x: cx,
      y: yTitle,
      maxWidth: SCENE_W * 0.9,
      fontSize: Math.round(38 * metaSafeScale),
      fontWeight: 700,
      family: metaFamily,
      color: titleColor,
      shadow: resolveShadow(t),
    });
  }
  if (o.artistName && o.artistName.trim()) {
    paintTextLines(ctx, {
      text: o.artistName,
      x: cx,
      y: yTitle + Math.round(50 * metaSafeScale),
      maxWidth: SCENE_W * 0.9,
      fontSize: Math.round(28 * metaSafeScale),
      fontWeight: 500,
      family: metaFamily,
      color: artistColor,
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

/**
 * Reactive waveform painter.
 *
 * Phase 5-5 upgrade: each bar's height now reads from a window of the
 * amplitude curve around the current playback time. The center bar
 * shows the moment's loudness; bars to the left/right look slightly
 * earlier/later in the curve. This produces a real "music spectrum
 * sliding past" effect instead of one global pulse multiplied by a
 * per-bar sin.
 *
 * When the amplitude curve isn't available (demo-pack, certain tests),
 * we fall back to the per-bar sin animation seeded with `ratio` so
 * something still moves. `amplitude` is the live single-sample loudness
 * used by templates that haven't passed a full curve.
 *
 * Note: export-time waveform is still rendered by ffmpeg drawbox in
 * filters.ts §7 (synthetic sin). Wiring the per-bar curve into ffmpeg
 * expressions is the Phase 5-6 follow-up — it's the same architectural
 * change as moving progress to drawbox in Phase 5-4.
 */
function paintWaveform(
  ctx: CanvasRenderingContext2D,
  color: string,
  ratio: number,
  amplitude: number | null,
  /** Optional center point (x,y) for the bar baseline. When null the
   *  legacy default position (center-x, y=H*0.84) is used. */
  position: { x: number; y: number } | null,
  /** Optional pre-computed amplitude curve. When provided, each bar's
   *  height is sampled from a window around the current playback time
   *  → real spectrum-like motion. */
  curve: import('./types').AmplitudeCurve | null,
  /** Current playback time in seconds within the clip. */
  tNowSec: number,
): void {
  const bars = 32;
  const margin = 100;
  const region = SCENE_W - margin * 2;
  const slot = Math.floor(region / bars);
  const baseY = position ? Math.round(position.y) : Math.round(SCENE_H * 0.84);
  const baseX = position
    ? Math.round(position.x - region / 2)
    : margin;
  // Map raw amplitude (0..1) into a reactive boost applied on top of a
  // baseline so quiet sections still show some shape.
  const amp = amplitude == null ? null : Math.max(0, Math.min(1, amplitude));

  // Per-bar height — first preference is the amplitude curve window
  // (real spectrum motion); fallback is the per-bar sin animation.
  const heightForBar = (i: number): number => {
    if (curve && curve.values.length > 0) {
      // Window of ±0.6s around tNowSec, mapped across the bar count.
      const windowSec = 1.2;
      const offsetSec = ((i - bars / 2) / bars) * windowSec;
      const sampleT = Math.max(0, tNowSec + offsetSec);
      const idx = Math.min(
        curve.values.length - 1,
        Math.max(0, Math.round(sampleT / curve.intervalSec)),
      );
      const v = Math.max(0, Math.min(1, curve.values[idx] ?? 0));
      // Bars span 14..110 px. Quiet sections sit near the baseline so
      // the waveform never collapses to a flat line.
      return 14 + v * 96;
    }
    // Legacy sin path.
    const seed = (i * 37) % 100;
    const phase = ratio * Math.PI * 4 + i * 0.7;
    const baseline = (seed / 100) * 24 + 18;
    const sinShape = (0.5 + 0.5 * Math.sin(phase)) * 14;
    const reactive = (0.5 + 0.5 * Math.sin(phase * 1.3)) * (amp == null ? 0 : amp * 60);
    return Math.max(10, Math.min(110, baseline + sinShape + reactive));
  };

  ctx.save();
  for (let i = 0; i < bars; i++) {
    const h = heightForBar(i);
    const x = baseX + i * slot;
    // Highlight the center two bars (current playback position).
    const isCurrent = i >= bars / 2 - 1 && i <= bars / 2;
    ctx.fillStyle = withAlpha(
      color,
      isCurrent ? 1 : amp != null && amp > 0.6 ? 0.95 : 0.78,
    );
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

function paintReactiveOverlay(ctx: CanvasRenderingContext2D, o: RenderSceneOpts): void {
  const r = o.reactive;
  if (!r || (r.pulse <= 0 && r.bloom <= 0 && r.waveformBoost <= 0)) return;
  const t = o.template;

  // Soft pulse: subtle inward darkening at the edges that breathes with the
  // amplitude. Drawn as a radial-style gradient via two stacked rings of
  // black with low alpha.
  if (r.pulse > 0) {
    const alpha = 0.18 * r.pulse;
    const cx = SCENE_W / 2;
    const cy = SCENE_H / 2;
    const radius = SCENE_W * 0.85;
    const grad = ctx.createRadialGradient(cx, cy, radius * 0.55, cx, cy, radius);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${alpha.toFixed(3)})`);
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SCENE_W, SCENE_H);
    ctx.restore();
  }

  // Cinematic bloom: outer haze in the template's accent color.
  if (r.bloom > 0) {
    const alpha = 0.28 * r.bloom;
    const accent = t.glowColor ?? t.lyricSubColor;
    const cx = SCENE_W / 2;
    const cy = SCENE_H / 2;
    const radius = SCENE_W * 1.05;
    const grad = ctx.createRadialGradient(cx, cy, radius * 0.45, cx, cy, radius);
    grad.addColorStop(0, withAlpha(accent, alpha));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SCENE_W, SCENE_H);
    ctx.restore();
  }

  // Waveform boost: brighten/widen the waveform area with an additive halo.
  // The base waveform is drawn by ffmpeg drawbox in the export filter graph;
  // this halo sits on top so peaks are visibly emphasized without changing
  // bar heights (which would require runtime ffmpeg expression rewriting).
  if (r.waveformBoost > 0 && resolveDisplay(t, o.styleOverrides ?? null).showWaveform) {
    const alpha = 0.35 * r.waveformBoost;
    const yMid = Math.round(SCENE_H * 0.84);
    const halfH = 90;
    const grad = ctx.createLinearGradient(0, yMid - halfH, 0, yMid + halfH);
    grad.addColorStop(0, withAlpha(t.lyricColor, 0));
    grad.addColorStop(0.5, withAlpha(t.lyricColor, alpha));
    grad.addColorStop(1, withAlpha(t.lyricColor, 0));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.fillRect(60, yMid - halfH, SCENE_W - 120, halfH * 2);
    ctx.restore();
  }
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

