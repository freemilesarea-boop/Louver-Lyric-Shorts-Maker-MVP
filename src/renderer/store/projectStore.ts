import { create } from 'zustand';
import type {
  AmplitudeCurve,
  AnimationPreset,
  LanguageCode,
  LyricLine,
  MotionPreset,
  ReactiveMode,
  RenderProgress,
  Template,
} from '../../shared/types';
import { templates } from '../templates/templates';
import { detectLanguage } from '../../shared/lang';

export type Screen = 'start' | 'editor' | 'export';

interface ProjectState {
  screen: Screen;

  imagePath: string | null;
  imageDataUrl: string | null;
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

  /** Pre-computed amplitude timeline for the active clip range. */
  amplitudeCurve: AmplitudeCurve | null;

  selectedTemplateId: string;

  outputDir: string | null;
  lastRenderProgress: RenderProgress | null;
  lastOutputPath: string | null;
  isRendering: boolean;
  lastError: string | null;

  setScreen: (s: Screen) => void;
  setImage: (p: string | null, dataUrl?: string | null) => void;
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
  setAmplitudeCurve: (curve: AmplitudeCurve | null) => void;
  setSelectedTemplate: (id: string) => void;
  setOutputDir: (dir: string | null) => void;

  setRenderProgress: (p: RenderProgress) => void;
  setIsRendering: (v: boolean) => void;
  setLastOutputPath: (p: string | null) => void;
  setLastError: (e: string | null) => void;
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
  amplitudeCurve: null,

  selectedTemplateId: templates[0].id,

  outputDir: null,
  lastRenderProgress: null,
  lastOutputPath: null,
  isRendering: false,
  lastError: null,

  setScreen: (screen) => set({ screen }),
  setImage: (imagePath, imageDataUrl = null) =>
    set({ imagePath, imageDataUrl: imageDataUrl ?? null }),
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
  setAmplitudeCurve: (amplitudeCurve) => set({ amplitudeCurve }),
  setSelectedTemplate: (selectedTemplateId) => set({ selectedTemplateId }),
  setOutputDir: (outputDir) => set({ outputDir }),

  setRenderProgress: (lastRenderProgress) => set({ lastRenderProgress }),
  setIsRendering: (isRendering) => set({ isRendering }),
  setLastOutputPath: (lastOutputPath) => set({ lastOutputPath }),
  setLastError: (lastError) => set({ lastError }),
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
