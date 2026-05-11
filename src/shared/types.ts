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
  /** Optional user style tweaks. Older presets saved before Phase 5-3
   *  don't carry this field; readers must default to empty overrides. */
  styleOverrides?: StyleOverrides;
  /** Optional per-element drag positions. Phase 5-5+. */
  layoutOverrides?: LayoutOverrides;
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
  /** Optional player-style chrome painted as part of the scene chrome
   *  layer. When set, paints a subtle music-app-feel card with track line,
   *  progress, controls. Self-design only — no platform logos / glyphs. */
  playerChrome?: 'apple-like' | 'spotify-like' | 'youtube-like';
}

/** Optional visual effect added to lyric text on top of the template's
 *  base shadow + the animation/reactive glow. Each preset is tuned so a
 *  user can pick a vibe ("네온사인 / 부드러운 그림자") without breaking
 *  the existing animation+reactive glow stack. */
export type LyricEffect =
  | 'none'
  | 'soft_shadow'
  | 'neon'
  | 'glow'
  | 'outline'
  | 'subtle_blur_glow';

export const LYRIC_EFFECTS: LyricEffect[] = [
  'none',
  'soft_shadow',
  'neon',
  'glow',
  'outline',
  'subtle_blur_glow',
];

export const LYRIC_EFFECT_LABEL: Record<LyricEffect, string> = {
  none: '없음',
  soft_shadow: '부드러운 그림자',
  neon: '네온사인',
  glow: '글로우',
  outline: '외곽선',
  subtle_blur_glow: '몽환 글로우',
};

/**
 * User-side style overrides. All fields optional — null/undefined falls
 * back to the template's value. Stored on the project + persisted in
 * custom presets so a saved style ships with the user's tweaks intact.
 *
 * Phase 5-3 shipped the four highest-impact controls (border, lyric
 * colors, scale). Phase 5-4 adds: lyric visual effect, lyric font
 * scale, and a parallel set of meta (track title / artist) overrides.
 * Adding more knobs later is purely a matter of extending this type +
 * the editor UI; the threading code already covers the plumbing.
 */
export interface StyleOverrides {
  /** Solid color for the photo card border. Falls back to template.frameColor. */
  mainBorderColor?: string;
  /** Override for English lyric color. Falls back to template.lyricColor. */
  lyricPrimaryColor?: string;
  /** Override for Korean (sub-language) lyric color. Falls back to
   *  template.lyricSubColor. */
  lyricSecondaryColor?: string;
  /** Multiplicative scale on the main photo box (0.6..1.2). 1 = no change. */
  mainScale?: number;
  /** Visual effect added to lyric text. Layered on top of the template's
   *  base shadow + active animation/reactive glow. */
  lyricEffect?: LyricEffect;
  /** Multiplicative scale on the lyric font size (0.75..1.5). 1 = no
   *  change. Applied to both English and Korean lyric lines. */
  lyricFontScale?: number;
  /** Font key for track title / artist text. When unset, meta uses the
   *  same font as lyrics. */
  metaFontKey?: string;
  /** Override for both track title and artist text color. */
  metaColor?: string;
  /** Multiplicative scale on the meta font size (0.75..1.5). 1 = no
   *  change. Applied to both title and artist. */
  metaFontScale?: number;
}

/** Identity overrides — every field unset / passthrough. */
export const EMPTY_STYLE_OVERRIDES: StyleOverrides = {};

/**
 * Kind of main media the user uploaded. Phase 5-6 ships image + gif;
 * video (mp4/mov/webm/m4v) defers to Phase 5-7. The type already has a
 * 'video' slot so the renderer can branch on it without re-typing.
 */
export type MediaKind = 'image' | 'gif' | 'video';

/**
 * Main media — replaces the legacy single `imagePath` field. The kind
 * tells the renderer how to feed it into ffmpeg (still image needs
 * `-loop 1 -framerate N`, video/gif needs `-stream_loop -1` with a
 * trim window).
 */
export interface MainMedia {
  path: string;
  kind: MediaKind;
  /** Source-time trim start (within the file itself, not the output
   *  clip). Video/gif only; null for still images. */
  sourceStartSec?: number;
  /** Source-time trim end. Same constraints as sourceStartSec. */
  sourceEndSec?: number;
  /** When true (default for video/gif), the source loops to fill the
   *  output duration if the source is shorter. When false, the last
   *  frame freezes for the remainder. */
  loop?: boolean;
}

/**
 * Per-element absolute position override in canonical 1080×1920 space.
 * Each layoutOverrides field is independently optional. When set, the
 * scene painter uses these coordinates as the element's CENTER (or top-
 * left for elements that anchor by top-left, documented per field).
 *
 * Phase 5-5 ships drag for the three highest-impact elements (lyric,
 * meta, waveform). Player progress / controls drag is deferred to a
 * follow-up; the type already has slots so adding them later is a
 * matter of extending the drag overlay UI.
 */
export interface LayoutPoint {
  /** 0..SCENE_W (=1080). */
  x: number;
  /** 0..SCENE_H (=1920). */
  y: number;
}

export interface LayoutOverrides {
  /** Lyric vertical anchor — overrides resolveLyricPositioning. The user
   *  drags by the lyric's text BASELINE (paintLyric uses textBaseline
   *  'middle'), so y is the line's vertical mid-point. */
  lyric?: LayoutPoint;
  /** Track-meta (title + artist) anchor — overrides paintMeta's default
   *  centered y=H*0.78. x=center, y=title row middle. */
  meta?: LayoutPoint;
  /** Waveform mid-line center — overrides scene.ts paintWaveform's
   *  default baseY=H*0.84. The bars splay symmetrically around y. */
  waveform?: LayoutPoint;
}

export const EMPTY_LAYOUT_OVERRIDES: LayoutOverrides = {};

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
  /**
   * Main media path. Required. The user's primary photo / animated gif /
   * (Phase 5-7) video. Drawn as the centered foreground card and (when
   * no `backgroundImagePath` is given) also as the blurred backdrop.
   *
   * Field name kept as `imagePath` for backwards compatibility with the
   * existing IPC + custom presets. See `mainMediaKind` for how the
   * pipeline should feed this to ffmpeg.
   */
  imagePath: string;
  /**
   * Phase 5-6: kind of main media. When omitted the pipeline treats it
   * as 'image' (the v1 behavior). 'gif' = use ffmpeg gif demuxer with
   * `-stream_loop -1` so the gif loops to fill the output duration.
   * 'video' = same loop strategy but with `-ss / -t` trimming, deferred
   * to Phase 5-7.
   */
  mainMediaKind?: MediaKind;
  /** Source-time trim start for video/gif. Ignored for images. */
  mainMediaSourceStartSec?: number;
  /** Source-time trim end for video/gif. Ignored for images. */
  mainMediaSourceEndSec?: number;
  /** Whether the source loops to fill the output duration (default true
   *  for video/gif). */
  mainMediaLoop?: boolean;
  /**
   * Optional separate background. When set, this image is the blurred
   * cover-cropped backdrop and `imagePath` is the centered foreground.
   * When null/undefined, the main image doubles as the background (legacy
   * behavior).
   */
  backgroundImagePath?: string | null;
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
  /**
   * Optional ffmpeg encode override. Bundled per export preset (see
   * src/shared/exportPresets.ts). Omitted = pipeline falls back to the
   * historical defaults (medium / CRF 20 / 192k AAC).
   */
  exportEncode?: {
    videoPreset: 'ultrafast' | 'fast' | 'medium' | 'slow';
    videoCrf: number;
    audioBitrateKbps: number;
  };
  /** User's per-project visual tweaks. Applied on top of the chosen
   *  template's defaults. Pipeline forwards to the same renderScene path
   *  the preview uses, so the override pixels match. */
  styleOverrides?: StyleOverrides;
  /** Per-element absolute positions (canonical 1080×1920) for elements
   *  the user dragged in the preview. Empty/missing → template defaults. */
  layoutOverrides?: LayoutOverrides;
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
