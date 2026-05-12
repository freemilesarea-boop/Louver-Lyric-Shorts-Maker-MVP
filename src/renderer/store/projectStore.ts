import { create } from 'zustand';
import type {
  AmplitudeCurve,
  AnimationPreset,
  FxPreset,
  LanguageCode,
  LayoutOverrides,
  LyricLine,
  LyricPosition,
  MotionPreset,
  ReactiveMode,
  RenderProgress,
  RenderTimings,
  StyleOverrides,
  Template,
} from '../../shared/types';
import { EMPTY_LAYOUT_OVERRIDES, EMPTY_STYLE_OVERRIDES } from '../../shared/types';
import { templates } from '../templates/templates';
import { detectLanguage } from '../../shared/lang';
import type { FontKey } from '../../shared/fonts';
import {
  DEFAULT_EXPORT_PRESET_KEY,
  EXPORT_PRESETS,
  type ExportPresetKey,
} from '../../shared/exportPresets';
import {
  DEFAULT_WATERMARK_CONFIG,
  type WatermarkPosition,
} from '../../shared/watermark';

export type Screen = 'start' | 'editor' | 'export';

export type BatchItemStatus = 'pending' | 'rendering' | 'done' | 'failed' | 'skipped';

export interface BatchItem {
  /** Stable id, e.g. preset id or template id. Used for the filename tag. */
  id: string;
  /** Human label shown in the UI. */
  label: string;
  templateId: string;
  motionPreset: MotionPreset;
  animationPreset: AnimationPreset;
  reactiveMode: ReactiveMode;
  fxPreset: FxPreset;
  language: LanguageCode;
  status: BatchItemStatus;
  progressPercent?: number;
  outputPath?: string;
  error?: string;
  timings?: RenderTimings;
}

interface ProjectState {
  screen: Screen;

  /** Main media (the user's primary photo / gif / video). The path
   *  field is named `imagePath` for backwards-compat — see
   *  `mainMediaKind` for what's actually in there. */
  imagePath: string | null;
  /** Renderable src for <img>/<video> elements. Phase 5-6.1: this is
   *  a data: URL only for small still images; gif / video / oversized
   *  images go through the privileged `media://` scheme so we never
   *  base64-encode large files (V8 caps single-string size at ~512MB). */
  imageDataUrl: string | null;
  /** Phase 5-6: kind of the main media. Drives how preview + export
   *  feed it to ffmpeg/canvas. Defaults to 'image' for legacy/empty
   *  state; populated by the file picker based on extension. */
  mainMediaKind: import('../../shared/types').MediaKind;
  /** Optional background media. When null the main image doubles as the
   *  background (legacy behavior). When set, renderScene + ffmpeg use this
   *  as the blurred backdrop and `imagePath` as the foreground card. */
  backgroundImagePath: string | null;
  backgroundImageDataUrl: string | null;
  audioPath: string | null;
  audioDataUrl: string | null;
  audioDurationSec: number;
  startSec: number;
  durationSec: 15 | 30 | 60;

  /** Free-form text the user typed/edited. */
  lyricsRaw: string;
  /** Parsed structured lines, with optional Korean pairing and timing. */
  parsedLyrics: LyricLine[];

  highlightKorean: boolean;
  trackTitle: string;
  artistName: string;

  /** Detected from lyricsRaw — recomputed whenever the text changes. */
  detectedLanguage: LanguageCode;
  /** Null = follow detection. Non-null = user picked manually. */
  manualLanguage: LanguageCode | null;

  /** Null = follow the selected template's default. Non-null = user override. */
  manualMotionPreset: MotionPreset | null;

  /** Null = follow template default. Non-null = user override. */
  manualAnimationPreset: AnimationPreset | null;

  /** Null = follow template default. Non-null = user override. */
  manualReactiveMode: ReactiveMode | null;

  /** Null = follow template default. Non-null = user override. */
  manualFxPreset: FxPreset | null;

  /** Pre-computed amplitude timeline for the active clip range. */
  amplitudeCurve: AmplitudeCurve | null;

  /** Karaoke "lite" — paint active token as time progresses. Default off. */
  karaokeEnabled: boolean;

  /** Mobile safe-zone preview overlay (preview-only — never exported). */
  safeZoneEnabled: boolean;
  safeZonePlatform: 'shorts' | 'reels' | 'tiktok';

  /** Auto-safe-position override. Null = use the template's own
   *  lyricPosition. Non-null = override (applies to preview AND export). */
  manualLyricPosition: LyricPosition | null;

  /** Single source of truth for the font feature. Null = follow the
   *  per-language default (`defaultFontForLanguage`). Non-null = explicit
   *  user pick — applies to preview canvas AND export PNG keyframes. */
  userFontKey: FontKey | null;

  /** Active export preset. Drives encode params + filename suffix; the
   *  setter also auto-links the safe-zone platform when the preset has one. */
  exportPresetKey: ExportPresetKey;

  /** Subtle branding overlay shown in preview AND baked into export.
   *  Default: ON during dev (the brief calls for it). Tier hook in
   *  shared/watermark.ts owns any future free/pro override. */
  watermarkEnabled: boolean;
  /** Empty string = use the bundled default ("Made with Louver"). */
  watermarkText: string;
  watermarkPosition: WatermarkPosition;

  /** Per-project visual tweaks. Empty object = use template defaults
   *  unchanged. Each field is independently optional so the user can
   *  override one knob without committing to all. Persists into custom
   *  presets. */
  styleOverrides: StyleOverrides;

  /** Per-element drag positions (canonical 1080×1920). Empty by default;
   *  populated as the user drags elements in "위치 편집 모드". Persists
   *  into custom presets. */
  layoutOverrides: LayoutOverrides;
  /** When true, the preview shows drag handles on layoutable elements
   *  and listens for drag gestures. Preview-only state, never exported. */
  layoutEditMode: boolean;

  selectedTemplateId: string;

  outputDir: string | null;
  lastRenderProgress: RenderProgress | null;
  lastOutputPath: string | null;
  lastRenderTimings: RenderTimings | null;
  isRendering: boolean;
  lastError: string | null;

  /** Batch render queue. Length === 1 means single-render UX. */
  batchItems: BatchItem[];
  batchActiveIdx: number;
  batchCancelRequested: boolean;
  batchStartedAt: number | null;
  batchFinishedAt: number | null;

  setScreen: (s: Screen) => void;
  setImage: (
    p: string | null,
    dataUrl?: string | null,
    kind?: import('../../shared/types').MediaKind,
  ) => void;
  setBackgroundImage: (p: string | null, dataUrl?: string | null) => void;
  setAudio: (p: string | null, dataUrl?: string | null, durationSec?: number) => void;
  setStartSec: (s: number) => void;
  setDurationSec: (d: 15 | 30 | 60) => void;
  setLyricsRaw: (raw: string) => void;
  /** Update an individual parsed line's timing fields. */
  updateLyricTiming: (index: number, patch: Partial<Pick<LyricLine, 'start' | 'end'>>) => void;
  /** Distribute lines evenly across [0, durationSec]. */
  redistributeLyricsEvenly: () => void;
  setHighlightKorean: (v: boolean) => void;
  setTrackTitle: (s: string) => void;
  setArtistName: (s: string) => void;
  setManualLanguage: (lang: LanguageCode | null) => void;
  setManualMotionPreset: (preset: MotionPreset | null) => void;
  setManualAnimationPreset: (preset: AnimationPreset | null) => void;
  setManualReactiveMode: (mode: ReactiveMode | null) => void;
  setManualFxPreset: (preset: FxPreset | null) => void;
  setAmplitudeCurve: (curve: AmplitudeCurve | null) => void;
  setKaraokeEnabled: (v: boolean) => void;
  setSafeZoneEnabled: (v: boolean) => void;
  setSafeZonePlatform: (p: 'shorts' | 'reels' | 'tiktok') => void;
  setManualLyricPosition: (p: LyricPosition | null) => void;
  setUserFontKey: (k: FontKey | null) => void;
  setExportPresetKey: (k: ExportPresetKey) => void;
  setWatermarkEnabled: (v: boolean) => void;
  setWatermarkText: (s: string) => void;
  setWatermarkPosition: (p: WatermarkPosition) => void;
  /** Patch the styleOverrides with the provided partial — keys with
   *  `undefined` clear that override, keys with a value set it. */
  setStyleOverrides: (patch: Partial<StyleOverrides>) => void;
  resetStyleOverrides: () => void;
  /** Set or clear a single layout element's position. Passing
   *  `undefined` for `point` clears that element's override. */
  setLayoutOverride: (key: keyof LayoutOverrides, point: { x: number; y: number } | undefined) => void;
  resetLayoutOverrides: () => void;
  setLayoutEditMode: (v: boolean) => void;
  setSelectedTemplate: (id: string) => void;
  setOutputDir: (dir: string | null) => void;

  setRenderProgress: (p: RenderProgress) => void;
  setIsRendering: (v: boolean) => void;
  setLastOutputPath: (p: string | null) => void;
  setLastRenderTimings: (t: RenderTimings | null) => void;
  setLastError: (e: string | null) => void;

  /** Batch render — replace queue and reset bookkeeping. */
  startBatch: (items: BatchItem[]) => void;
  setBatchActiveIdx: (i: number) => void;
  updateBatchItem: (i: number, patch: Partial<BatchItem>) => void;
  requestBatchCancel: () => void;
  finishBatch: () => void;
  resetBatch: () => void;
}

/**
 * Parse lyrics text into structured lines.
 * Pairs adjacent lines as (English, Korean) when one of them contains Hangul.
 * Empty line = end-of-pair marker.
 */
export function parseLyrics(raw: string): LyricLine[] {
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  const out: LyricLine[] = [];
  let pending: LyricLine | null = null;

  for (const line of lines) {
    if (line.length === 0) {
      if (pending) {
        out.push(pending);
        pending = null;
      }
      continue;
    }
    const isKorean = /[가-힯ᄀ-ᇿ]/.test(line);
    if (isKorean && pending && !pending.ko) {
      pending.ko = line;
      out.push(pending);
      pending = null;
    } else {
      if (pending) {
        out.push(pending);
        pending = null;
      }
      pending = isKorean ? { text: '', ko: line } : { text: line };
    }
  }
  if (pending) out.push(pending);
  return out;
}

function distributeEvenly(lines: LyricLine[], durationSec: number): LyricLine[] {
  if (lines.length === 0) return lines;
  const slice = durationSec / lines.length;
  return lines.map((l, i) => ({
    ...l,
    start: Number((i * slice).toFixed(2)),
    end: Number(((i + 1) * slice).toFixed(2)),
  }));
}

export const useProjectStore = create<ProjectState>((set) => ({
  screen: 'start',
  imagePath: null,
  imageDataUrl: null,
  mainMediaKind: 'image',
  backgroundImagePath: null,
  backgroundImageDataUrl: null,
  audioPath: null,
  audioDataUrl: null,
  audioDurationSec: 0,
  startSec: 0,
  durationSec: 15,

  lyricsRaw: '',
  parsedLyrics: [],

  highlightKorean: true,
  trackTitle: '',
  artistName: '',

  detectedLanguage: 'unknown',
  manualLanguage: null,

  manualMotionPreset: null,
  manualAnimationPreset: null,
  manualReactiveMode: null,
  manualFxPreset: null,
  amplitudeCurve: null,
  karaokeEnabled: false,
  safeZoneEnabled: false,
  safeZonePlatform: 'shorts',
  manualLyricPosition: null,
  userFontKey: null,
  exportPresetKey: DEFAULT_EXPORT_PRESET_KEY,
  watermarkEnabled: DEFAULT_WATERMARK_CONFIG.enabled,
  watermarkText: DEFAULT_WATERMARK_CONFIG.text,
  watermarkPosition: DEFAULT_WATERMARK_CONFIG.position,
  styleOverrides: { ...EMPTY_STYLE_OVERRIDES },
  layoutOverrides: { ...EMPTY_LAYOUT_OVERRIDES },
  layoutEditMode: false,

  selectedTemplateId: templates[0].id,

  outputDir: null,
  lastRenderProgress: null,
  lastOutputPath: null,
  lastRenderTimings: null,
  isRendering: false,
  lastError: null,

  batchItems: [],
  batchActiveIdx: -1,
  batchCancelRequested: false,
  batchStartedAt: null,
  batchFinishedAt: null,

  setScreen: (screen) => set({ screen }),
  setImage: (imagePath, imageDataUrl = null, kind) =>
    set({
      imagePath,
      imageDataUrl: imageDataUrl ?? null,
      mainMediaKind: kind ?? 'image',
    }),
  setBackgroundImage: (backgroundImagePath, backgroundImageDataUrl = null) =>
    set({
      backgroundImagePath,
      backgroundImageDataUrl: backgroundImageDataUrl ?? null,
    }),
  setAudio: (audioPath, audioDataUrl = null, audioDurationSec) =>
    set((s) => ({
      audioPath,
      audioDataUrl: audioDataUrl ?? null,
      audioDurationSec: audioDurationSec ?? s.audioDurationSec,
      startSec: 0,
    })),
  setStartSec: (startSec) => set({ startSec: Math.max(0, startSec) }),
  setDurationSec: (durationSec) =>
    set((s) => ({
      durationSec,
      // Re-distribute timings on duration change so lines stay within bounds.
      parsedLyrics: s.parsedLyrics.length > 0
        ? distributeEvenly(s.parsedLyrics, durationSec)
        : s.parsedLyrics,
    })),
  setLyricsRaw: (lyricsRaw) =>
    set((s) => {
      const parsed = parseLyrics(lyricsRaw);
      // Editing the text resets timings to even distribution. Per-line
      // adjustments live in updateLyricTiming and survive non-text changes.
      const distributed = distributeEvenly(parsed, s.durationSec);
      const detection = detectLanguage(lyricsRaw);
      return {
        lyricsRaw,
        parsedLyrics: distributed,
        detectedLanguage: detection.language,
      };
    }),
  updateLyricTiming: (index, patch) =>
    set((s) => ({
      parsedLyrics: s.parsedLyrics.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    })),
  redistributeLyricsEvenly: () =>
    set((s) => ({
      parsedLyrics: distributeEvenly(s.parsedLyrics, s.durationSec),
    })),
  setHighlightKorean: (highlightKorean) => set({ highlightKorean }),
  setTrackTitle: (trackTitle) => set({ trackTitle }),
  setArtistName: (artistName) => set({ artistName }),
  setManualLanguage: (manualLanguage) => set({ manualLanguage }),
  setManualMotionPreset: (manualMotionPreset) => set({ manualMotionPreset }),
  setManualAnimationPreset: (manualAnimationPreset) => set({ manualAnimationPreset }),
  setManualReactiveMode: (manualReactiveMode) => set({ manualReactiveMode }),
  setManualFxPreset: (manualFxPreset) => set({ manualFxPreset }),
  setAmplitudeCurve: (amplitudeCurve) => set({ amplitudeCurve }),
  setKaraokeEnabled: (karaokeEnabled) => set({ karaokeEnabled }),
  setSafeZoneEnabled: (safeZoneEnabled) => set({ safeZoneEnabled }),
  setSafeZonePlatform: (safeZonePlatform) => set({ safeZonePlatform }),
  setManualLyricPosition: (manualLyricPosition) => set({ manualLyricPosition }),
  setUserFontKey: (userFontKey) => set({ userFontKey }),
  setExportPresetKey: (exportPresetKey) =>
    set(() => {
      // Auto-link the safe-zone platform when the preset specifies one.
      // Master preset (safeZonePlatform: null) leaves the user's current
      // safe-zone selection alone.
      const def = EXPORT_PRESETS[exportPresetKey];
      const patch: Partial<ProjectState> = { exportPresetKey };
      if (def.safeZonePlatform) patch.safeZonePlatform = def.safeZonePlatform;
      return patch;
    }),
  setWatermarkEnabled: (watermarkEnabled) => set({ watermarkEnabled }),
  setWatermarkText: (watermarkText) => set({ watermarkText }),
  setWatermarkPosition: (watermarkPosition) => set({ watermarkPosition }),
  setStyleOverrides: (patch) =>
    set((s) => {
      const next: StyleOverrides = { ...s.styleOverrides };
      // Treat undefined as "clear this override" so the UI can ship a
      // single setter for both apply + clear.
      for (const [key, value] of Object.entries(patch) as Array<
        [keyof StyleOverrides, StyleOverrides[keyof StyleOverrides]]
      >) {
        if (value === undefined) {
          delete next[key];
        } else {
          (next as Record<string, unknown>)[key] = value;
        }
      }
      return { styleOverrides: next };
    }),
  resetStyleOverrides: () => set({ styleOverrides: { ...EMPTY_STYLE_OVERRIDES } }),
  setLayoutOverride: (key, point) =>
    set((s) => {
      const next: LayoutOverrides = { ...s.layoutOverrides };
      if (point === undefined) {
        delete next[key];
      } else {
        // Clamp to canonical canvas to avoid off-frame drags.
        const x = Math.max(0, Math.min(1080, point.x));
        const y = Math.max(0, Math.min(1920, point.y));
        next[key] = { x, y };
      }
      return { layoutOverrides: next };
    }),
  resetLayoutOverrides: () =>
    set({ layoutOverrides: { ...EMPTY_LAYOUT_OVERRIDES } }),
  setLayoutEditMode: (layoutEditMode) => set({ layoutEditMode }),
  setSelectedTemplate: (selectedTemplateId) => set({ selectedTemplateId }),
  setOutputDir: (outputDir) => set({ outputDir }),

  setRenderProgress: (lastRenderProgress) => set({ lastRenderProgress }),
  setIsRendering: (isRendering) => set({ isRendering }),
  setLastOutputPath: (lastOutputPath) => set({ lastOutputPath }),
  setLastRenderTimings: (lastRenderTimings) => set({ lastRenderTimings }),
  setLastError: (lastError) => set({ lastError }),

  startBatch: (items) =>
    set({
      batchItems: items,
      batchActiveIdx: -1,
      batchCancelRequested: false,
      batchStartedAt: Date.now(),
      batchFinishedAt: null,
    }),
  setBatchActiveIdx: (batchActiveIdx) => set({ batchActiveIdx }),
  updateBatchItem: (i, patch) =>
    set((s) => ({
      batchItems: s.batchItems.map((b, idx) => (idx === i ? { ...b, ...patch } : b)),
    })),
  requestBatchCancel: () => set({ batchCancelRequested: true }),
  finishBatch: () => set({ batchFinishedAt: Date.now() }),
  resetBatch: () =>
    set({
      batchItems: [],
      batchActiveIdx: -1,
      batchCancelRequested: false,
      batchStartedAt: null,
      batchFinishedAt: null,
    }),
}));

export function selectedTemplate(state: ProjectState): Template {
  return templates.find((t) => t.id === state.selectedTemplateId) ?? templates[0];
}

export function effectiveLanguage(state: ProjectState): LanguageCode {
  return state.manualLanguage ?? state.detectedLanguage;
}

export function effectiveMotion(state: ProjectState): MotionPreset {
  if (state.manualMotionPreset) return state.manualMotionPreset;
  const tpl = templates.find((t) => t.id === state.selectedTemplateId) ?? templates[0];
  return tpl.motionPreset ?? 'none';
}

export function effectiveAnimation(state: ProjectState): AnimationPreset {
  if (state.manualAnimationPreset) return state.manualAnimationPreset;
  const tpl = templates.find((t) => t.id === state.selectedTemplateId) ?? templates[0];
  return tpl.animationPreset ?? 'none';
}

export function effectiveReactive(state: ProjectState): ReactiveMode {
  if (state.manualReactiveMode) return state.manualReactiveMode;
  const tpl = templates.find((t) => t.id === state.selectedTemplateId) ?? templates[0];
  return tpl.reactiveMode ?? 'none';
}

export function effectiveLayout(state: ProjectState): LayoutOverrides {
  return state.layoutOverrides;
}

export function effectiveWatermark(
  state: ProjectState,
): import('../../shared/watermark').WatermarkConfig {
  return {
    enabled: state.watermarkEnabled,
    text: state.watermarkText,
    position: state.watermarkPosition,
  };
}

export function effectiveFx(state: ProjectState): FxPreset {
  if (state.manualFxPreset) return state.manualFxPreset;
  const tpl = templates.find((t) => t.id === state.selectedTemplateId) ?? templates[0];
  return tpl.cinematicFxPreset ?? 'none';
}
