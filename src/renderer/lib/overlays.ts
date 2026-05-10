import type {
  AmplitudeCurve,
  AnimationPreset,
  FxPreset,
  LanguageCode,
  LyricLine,
  LyricPosition,
  OverlayPng,
  ReactiveMode,
  Template,
} from '../../shared/types';
import { renderScene, SCENE_W, SCENE_H, lyricWordCount } from '../../shared/scene';
import {
  ANIMATION_KEYFRAME_FPS,
  ENTER_SEC,
  EXIT_SEC,
  REST_STATE,
  animationStateAt,
  isStaticAnimation,
  planKeyframes,
} from '../../shared/animation';
import { reactiveStateAt } from '../../shared/audioReactive';
import { fxConfigForPreset } from '../../shared/cinematicFx';
import type { FontKey } from '../../shared/fonts';

interface BuildOpts {
  lyrics: LyricLine[];
  template: Template;
  language: LanguageCode;
  animationPreset: AnimationPreset;
  reactiveMode: ReactiveMode;
  amplitudeCurve: AmplitudeCurve | null;
  fxPreset: FxPreset;
  highlightSub: boolean;
  durationSec: number;
  trackTitle?: string;
  artistName?: string;
  /** When true, hold phase is subdivided into one keyframe per word so the
   *  active-word visual updates throughout the chunk. */
  karaokeEnabled?: boolean;
  /** Auto-safe-position override — wins over each template's
   *  lyricPosition when set (applies to every keyframe in this batch). */
  lyricPositionOverride?: LyricPosition | null;
  /** User-picked font key (FontSelector). Wins over template font stack
   *  when set; null/undefined falls back to per-language default. */
  fontKey?: FontKey | null;
}

export interface SlicedLyric {
  line: LyricLine;
  start: number;
  end: number;
}

export function sliceLyrics(lyrics: LyricLine[], durationSec: number): SlicedLyric[] {
  const visible = lyrics.filter((l) => (l.text && l.text.trim()) || (l.ko && l.ko.trim()));
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
      start: clamp(line.start ?? 0, 0, durationSec),
      end: clamp(line.end ?? durationSec, 0, durationSec),
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
 * Hard ceiling on the number of overlay PNG inputs we feed to ffmpeg per
 * render. Many `-loop 1 -framerate 30 -i ...` pairs balloon the filter
 * graph and (depending on OS) exhaust file descriptors / hit ffmpeg's own
 * input cap. Empirically 192+ inputs starts misbehaving on Linux x86_64.
 *
 * When the projected keyframe count exceeds this, we throttle the
 * animation keyframe rate proportionally so the total stays under the cap.
 * Per-line animation may look slightly steppier with many lines, but the
 * render still completes successfully — far better than a hard failure.
 */
const MAX_OVERLAY_PNGS = 120;

function computeEffectiveKeyframeFps(
  animationPreset: BuildOpts['animationPreset'],
  chunkCount: number,
): number {
  if (isStaticAnimation(animationPreset) || chunkCount === 0) {
    return ANIMATION_KEYFRAME_FPS;
  }
  // Worst-case keyframes per chunk at full fps: enter + 1 hold + exit.
  const perChunkFull =
    Math.ceil(ENTER_SEC * ANIMATION_KEYFRAME_FPS) +
    1 +
    Math.ceil(EXIT_SEC * ANIMATION_KEYFRAME_FPS);
  const projected = perChunkFull * chunkCount;
  if (projected <= MAX_OVERLAY_PNGS) return ANIMATION_KEYFRAME_FPS;
  // Scale fps to fit, with floor so animations don't fully degenerate.
  const scaled = (ANIMATION_KEYFRAME_FPS * MAX_OVERLAY_PNGS) / projected;
  return Math.max(2, Math.round(scaled * 10) / 10);
}

export async function buildOverlays(opts: BuildOpts): Promise<OverlayPng[]> {
  const out: OverlayPng[] = [];
  const chunks = sliceLyrics(opts.lyrics, opts.durationSec);
  const fxConfig = fxConfigForPreset(opts.fxPreset);
  const keyframeFps = computeEffectiveKeyframeFps(opts.animationPreset, chunks.length);

  for (const chunk of chunks) {
    const chunkDur = Math.max(0, chunk.end - chunk.start);
    // When karaoke is on, subdivide the hold phase so each word activation
    // gets its own keyframe — otherwise the active-word would stay frozen
    // throughout the longest portion of the chunk.
    const wordCount = opts.karaokeEnabled ? lyricWordCount(chunk.line) : 0;
    const holdSubdivisions = opts.karaokeEnabled ? Math.max(1, wordCount) : undefined;
    const slots = planKeyframes(
      opts.animationPreset,
      chunkDur,
      keyframeFps,
      holdSubdivisions,
    );

    for (const slot of slots) {
      const animState = isStaticAnimation(opts.animationPreset)
        ? REST_STATE
        : animationStateAt(opts.animationPreset, chunkDur, slot.sampleSec);

      // Skip near-invisible exit tail keyframes — saves overlays without
      // visible impact. Always emit at least one keyframe per slot otherwise.
      if (animState.opacity <= 0.02) continue;

      // Sample reactive state at this keyframe's clip-relative time. The
      // result is baked into the PNG, so reactive effects show up exactly
      // where the lyric/meta is visible (no extra ffmpeg machinery).
      const tClip = chunk.start + slot.sampleSec;
      const reactive = reactiveStateAt(opts.reactiveMode, opts.amplitudeCurve, tClip);
      // Seed grain/dust per keyframe so each PNG has fresh noise but is
      // reproducible. Resolution is ~50ms — enough to feel like film grain.
      const fxSeed = Math.round(tClip * 1000) | 0;
      // Karaoke progress = position within this chunk, 0..1.
      const karaokeProgress = chunkDur > 0 ? slot.sampleSec / chunkDur : 0;

      const png = await renderOverlayPng({
        template: opts.template,
        language: opts.language,
        highlightSub: opts.highlightSub,
        lyric: chunk.line,
        animation: animState,
        reactive,
        fxConfig,
        fxSeed,
        karaoke: opts.karaokeEnabled
          ? { enabled: true, progress: karaokeProgress }
          : undefined,
        lyricPositionOverride: opts.lyricPositionOverride ?? null,
        fontKey: opts.fontKey ?? null,
      });
      out.push({
        base64: png,
        startSec: chunk.start + slot.windowStart,
        endSec: chunk.start + slot.windowEnd,
      });
    }
  }

  if (
    (opts.trackTitle && opts.trackTitle.trim()) ||
    (opts.artistName && opts.artistName.trim())
  ) {
    const png = await renderOverlayPng({
      template: opts.template,
      language: opts.language,
      highlightSub: opts.highlightSub,
      lyric: null,
      trackTitle: opts.trackTitle,
      artistName: opts.artistName,
      // Track meta is always-on; render with FX but no time-dependent seed.
      fxConfig,
      fxSeed: 0,
      fontKey: opts.fontKey ?? null,
    });
    out.push({ base64: png, startSec: 0, endSec: opts.durationSec });
  }

  return out;
}

interface OverlayPngOpts {
  template: Template;
  language: LanguageCode;
  highlightSub: boolean;
  lyric: LyricLine | null;
  trackTitle?: string;
  artistName?: string;
  animation?: import('../../shared/animation').AnimationState;
  reactive?: import('../../shared/audioReactive').ReactiveState;
  fxConfig?: import('../../shared/cinematicFx').FxConfig;
  fxSeed?: number;
  karaoke?: { enabled: boolean; progress: number };
  lyricPositionOverride?: LyricPosition | null;
  fontKey?: FontKey | null;
}

async function renderOverlayPng(o: OverlayPngOpts): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = SCENE_W;
  canvas.height = SCENE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  renderScene(ctx, {
    width: SCENE_W,
    height: SCENE_H,
    template: o.template,
    language: o.language,
    highlightSub: o.highlightSub,
    exportMode: true,
    lyric: o.lyric,
    trackTitle: o.trackTitle,
    artistName: o.artistName,
    animation: o.animation,
    reactive: o.reactive,
    fxConfig: o.fxConfig,
    fxSeed: o.fxSeed,
    karaoke: o.karaoke,
    lyricPositionOverride: o.lyricPositionOverride ?? null,
    fontKey: o.fontKey ?? null,
  });

  return await canvasToBase64Png(canvas);
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
