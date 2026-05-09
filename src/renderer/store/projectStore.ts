import { create } from 'zustand';
import type { LyricLine, RenderProgress, Template } from '../../shared/types';
import { templates } from '../templates/templates';

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

  lyricsRaw: string;
  parsedLyrics: LyricLine[];
  highlightKorean: boolean;
  trackTitle: string;
  artistName: string;

  selectedTemplateId: string;

  outputDir: string | null;
  lastRenderProgress: RenderProgress | null;
  lastOutputPath: string | null;
  isRendering: boolean;

  setScreen: (s: Screen) => void;
  setImage: (p: string | null, dataUrl?: string | null) => void;
  setAudio: (p: string | null, dataUrl?: string | null, durationSec?: number) => void;
  setStartSec: (s: number) => void;
  setDurationSec: (d: 15 | 30 | 60) => void;
  setLyricsRaw: (raw: string) => void;
  setHighlightKorean: (v: boolean) => void;
  setTrackTitle: (s: string) => void;
  setArtistName: (s: string) => void;
  setSelectedTemplate: (id: string) => void;
  setOutputDir: (dir: string | null) => void;

  setRenderProgress: (p: RenderProgress) => void;
  setIsRendering: (v: boolean) => void;
  setLastOutputPath: (p: string | null) => void;
}

/**
 * Parse lyrics text into structured lines.
 * Pairs lines like:
 *   English line
 *   한국어 줄  (becomes ko of previous English line)
 * Or each line by itself if no Korean follows.
 *
 * Heuristic: a line is treated as Korean if it contains any Hangul code point.
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

  selectedTemplateId: templates[0].id,

  outputDir: null,
  lastRenderProgress: null,
  lastOutputPath: null,
  isRendering: false,

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
  setDurationSec: (durationSec) => set({ durationSec }),
  setLyricsRaw: (lyricsRaw) => set({ lyricsRaw, parsedLyrics: parseLyrics(lyricsRaw) }),
  setHighlightKorean: (highlightKorean) => set({ highlightKorean }),
  setTrackTitle: (trackTitle) => set({ trackTitle }),
  setArtistName: (artistName) => set({ artistName }),
  setSelectedTemplate: (selectedTemplateId) => set({ selectedTemplateId }),
  setOutputDir: (outputDir) => set({ outputDir }),

  setRenderProgress: (lastRenderProgress) => set({ lastRenderProgress }),
  setIsRendering: (isRendering) => set({ isRendering }),
  setLastOutputPath: (lastOutputPath) => set({ lastOutputPath }),
}));

export function selectedTemplate(state: ProjectState): Template {
  return templates.find((t) => t.id === state.selectedTemplateId) ?? templates[0];
}
