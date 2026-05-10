export type LyricPosition =
  | 'top'
  | 'center'
  /** Slightly lower than `center` — used by auto-safe-position suggester. */
  | 'lower_center'
  /** Just above the platform bottom-UI band — used by auto-safe-position
   *  suggester. Visually similar to `bottom` but won't be covered by
   *  Shorts/Reels/TikTok caption rows. */
  | 'bottom_safe'
  | 'bottom';
export type LyricAlign = 'left' | 'center' | 'right';
export type ProgressBarStyle = 'none' | 'thin' | 'thick' | 'rounded';
export type BackgroundEffect = 'blur' | 'darken' | 'sepia' | 'none';
export type AnimationStyle = 'none' | 'fade' | 'slide';

export type LanguageCode = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'unknown';

export type FrameStyle =
  | 'none'
  | 'polaroid'
  | 'rounded'
  | 'circle'
  | 'cassette'
  | 'vinyl'
  | 'photo'
  | 'neon-border';

export type ShadowStyle = 'none' | 'soft' | 'hard' | 'glow' | 'outline';
export type PlayIconStyle = 'triangle' | 'rounded' | 'minimal' | 'none';

/** Photo motion presets applied to the centered foreground card. */
export type MotionPreset =
  | 'none'
  | 'slow_zoom_in'
  | 'slow_zoom_out'
  | 'pan_left'
  | 'pan_right'
  | 'float_soft';

/** Lyric line entry/exit animation. Subtle, music-shorts style — never TikTok-y. */
export type AnimationPreset =
  | 'none'
  | 'fade'
  | 'slide_up'
  | 'slide_down'
  | 'blur_fade'
  | 'soft_pop'
  | 'karaoke_glow';

/** Audio-reactive mode — drives subtle visual responses to amplitude. */
export type ReactiveMode =
  | 'none'
  | 'soft_pulse'
  | 'lyric_glow'
  | 'waveform_boost'
  | 'cinematic_bloom'
  | 'neon_pulse';

/**
 * User-saved style preset. Stored as plain JSON in Electron's userData dir
 * — see src/main/storage/customPresets.ts. `language: null` means "follow
 * detected language" rather than overriding it.
 */
export interface CustomPreset {
  id: string;
  name: string;
  templateId: string;
  motionPreset: MotionPreset;
  animationPreset: AnimationPreset;
  reactiveMode: ReactiveMode;
  cinematicFxPreset: FxPreset;
  language: LanguageCode | null;
  createdAt: number;
  updatedAt: number;
}

/** Cinematic FX preset — bundles grain / vignette / aberration / bloom etc. */
export type FxPreset =
  | 'none'
  | 'clean_cinematic'
  | 'subtle_bloom'
  | 'soft_blur'
  | 'dust_grain'
  | 'aberration_grain'
  | 'bloom_neon'
  | 'film_texture';

/**
 * Pre-computed amplitude timeline. Sample `values[i]` covers the time slot
 * `[i*intervalSec, (i+1)*intervalSec)`. Each value is in [0,1] after RMS,
 * smoothing, and percentile normalization.
 */
export interface AmplitudeCurve {
  intervalSec: number;
  values: number[];
  durationSec: number;
}

export interface FontStack {
  /** CSS font-family list. */
  base: string;
  /** Optional override per language; falls back to base. */
  byLang?: Partial<Record<LanguageCode, string>>;
}

export interface Template {
  id: string;
  name: string;
  description?: string;
  /** Pure CSS family stack used at render time. */
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lyricPosition: LyricPosition;
  lyricColor: string;
  lyricSubColor: string;
  lyricAlign: LyricAlign;
  showPlayerControl: boolean;
  showWaveform: boolean;
  progressBarStyle: ProgressBarStyle;
  backgroundEffect: BackgroundEffect;
  animationStyle: AnimationStyle;
  cardBg: string;
  overlayOpacity: number;

  /* New 1.5 fields — all optional with sensible defaults so the type is
     backwards-compatible with the original three templates. */
  fontStack?: FontStack;
  frameStyle?: FrameStyle;
  /** Margin from photo edge to frame edge, as fraction of frame width. */
  framePadding?: number;
  frameColor?: string;
  shadowStyle?: ShadowStyle;
  /** Used when shadowStyle is 'glow' or 'neon-border' frame. */
  glowColor?: string;
  playIconStyle?: PlayIconStyle;
  /** Optional decorative accents drawn on the overlay (template-specific). */
  decoration?: 'none' | 'scanlines' | 'grain' | 'sparkles' | 'reels';
  /** Default photo motion. User can override per-project. */
  motionPreset?: MotionPreset;
  /** Default lyric animation. User can override per-project. */
  animationPreset?: AnimationPreset;
  /** Default audio-reactive mode. User can override per-project. */
  reactiveMode?: ReactiveMode;
  /** Default cinematic FX preset. User can override per-project. */
  cinematicFxPreset?: FxPreset;
}

export interface LyricLine {
  text: string;
  ko?: string;
  start?: number;
  end?: number;
}

export interface AudioMeta {
  durationSec: number;
}

export interface OverlayPng {
  /** PNG bytes encoded as base64 (no data URL prefix). */
  base64: string;
  startSec: number;
  endSec: number;
}

export interface RenderRequest {
  imagePath: string;
  audioPath: string;
  lyrics: LyricLine[];
  template: Template;
  startSec: number;
  durationSec: 15 | 30 | 60;
  trackTitle?: string;
  artistName?: string;
  highlightKorean: boolean;
  outputPath?: string;
  /**
   * Pre-rendered lyric/meta overlays. Each PNG must be the full output size
   * (1080×1920) with a transparent background. They are composited onto the
   * frame in order via the overlay filter, gated by [start,end] seconds.
   */
  overlays?: OverlayPng[];
  /** Effective motion preset for this render. Falls back to template default. */
  motionPreset?: MotionPreset;
  /** Effective lyric animation preset for this render. */
  animationPreset?: AnimationPreset;
  /** Effective reactive mode for this render. */
  reactiveMode?: ReactiveMode;
  /** Pre-computed amplitude curve for this clip range. */
  amplitudeCurve?: AmplitudeCurve | null;
  /** Effective cinematic FX preset for this render. */
  fxPreset?: FxPreset;
  /**
   * Optional slug embedded in the output filename, e.g. `kballad_emotional`
   * → `lyric_short_kballad_emotional_<stamp>.mp4`. Used by batch render so
   * the user can tell the variants apart in their Videos folder.
   */
  nameTag?: string;
}

export interface RenderProgress {
  jobId: string;
  percent: number;
  stage: 'preparing' | 'rendering' | 'finalizing' | 'done' | 'error' | 'cancelled';
  message?: string;
  outputPath?: string;
}

export interface RenderResult {
  ok: boolean;
  outputPath?: string;
  error?: string;
  timings?: RenderTimings;
}

export interface RenderTimings {
  /** Wall time for ffmpeg child process. */
  ffmpegMs: number;
  /** Wall time materializing overlay PNGs to disk. */
  overlayMaterializeMs: number;
  /** Total wall time inside main-process renderer. */
  totalMs: number;
  /** Final output file size, bytes. */
  outputSizeBytes: number;
  /** Number of overlay PNGs the renderer baked. */
  overlayCount: number;
}
