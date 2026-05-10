import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AmplitudeCurve,
  AnimationPreset,
  FxPreset,
  LanguageCode,
  LyricLine,
  LyricPosition,
  MotionPreset,
  ReactiveMode,
  Template,
} from '../../shared/types';
import { renderScene, SCENE_W, SCENE_H } from '../../shared/scene';
import { isStaticMotion } from '../../shared/motion';
import {
  REST_STATE,
  animationStateAt,
  isStaticAnimation,
} from '../../shared/animation';
import { isStaticReactive, reactiveStateAt } from '../../shared/audioReactive';
import { fxConfigForPreset, isStaticFx } from '../../shared/cinematicFx';
import { paintSafeZones, type SafePlatform } from '../../shared/safeZones';
import type { FontKey } from '../../shared/fonts';
import { sliceLyrics } from '../lib/overlays';

interface Props {
  imageDataUrl: string | null;
  /** Optional separate background image. When null the main image
   *  doubles as the background (legacy behavior). */
  backgroundImageDataUrl?: string | null;
  template: Template;
  language: LanguageCode;
  lyrics: LyricLine[];
  highlightSub: boolean;
  trackTitle?: string;
  artistName?: string;
  durationSec: number;
  motionPreset: MotionPreset;
  animationPreset: AnimationPreset;
  reactiveMode: ReactiveMode;
  amplitudeCurve: AmplitudeCurve | null;
  fxPreset: FxPreset;
  karaokeEnabled: boolean;
  /** Mobile platform safe-zone overlay. Painted AFTER renderScene so it
   *  sits visually on top — and crucially, it never gets baked into the
   *  export PNG keyframes (overlays.ts doesn't import this). */
  safeZone?: { enabled: boolean; platform: SafePlatform };
  /** Auto-safe-position override applied to the lyric Y. Null = no override. */
  lyricPositionOverride: LyricPosition | null;
  /** User pick from FontSelector. Null = follow per-language default. */
  fontKey: FontKey | null;
  /** Watermark / branding overlay config. Null = no watermark in preview. */
  watermark?: import('../../shared/watermark').WatermarkConfig | null;
  /** Per-project visual tweaks applied on top of template defaults. */
  styleOverrides?: import('../../shared/types').StyleOverrides | null;
  forcedChunkIndex?: number | null;
}

const PREVIEW_FRAME_INTERVAL_MS = 1000 / 30;

/**
 * Canvas-based preview that renders at full 1080×1920 internally and uses CSS
 * to scale into its container.
 *
 * The preview keeps a continuous time loop that drives BOTH motion (which
 * cycles over the full duration) and lyric animation (which is sampled per
 * chunk). The same shared scene renderer also powers the export overlay
 * generator, so what shows here is what ships.
 */
export default function LivePreview(props: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [bgPhoto, setBgPhoto] = useState<HTMLImageElement | null>(null);
  const [tNowSec, setTNowSec] = useState(0);

  useEffect(() => {
    if (!props.imageDataUrl) {
      setPhoto(null);
      return;
    }
    const img = new Image();
    img.onload = () => setPhoto(img);
    img.onerror = () => setPhoto(null);
    img.src = props.imageDataUrl;
  }, [props.imageDataUrl]);

  useEffect(() => {
    if (!props.backgroundImageDataUrl) {
      setBgPhoto(null);
      return;
    }
    const img = new Image();
    img.onload = () => setBgPhoto(img);
    img.onerror = () => setBgPhoto(null);
    img.src = props.backgroundImageDataUrl;
  }, [props.backgroundImageDataUrl]);

  // Compute clip-relative chunk windows once per inputs change.
  const chunks = useMemo(
    () => sliceLyrics(props.lyrics, props.durationSec),
    [props.lyrics, props.durationSec],
  );

  // Continuous time loop: tNowSec ranges over [0, durationSec) and drives
  // every animated layer (motion, lyric animation, progress, waveform).
  useEffect(() => {
    if (props.durationSec <= 0) return;
    const fxConfigForActiveCheck = fxConfigForPreset(props.fxPreset);
    const animationsActive =
      !isStaticAnimation(props.animationPreset) ||
      !isStaticMotion(props.motionPreset) ||
      !isStaticReactive(props.reactiveMode) ||
      !isStaticFx(fxConfigForActiveCheck) ||
      props.template.showWaveform ||
      props.template.progressBarStyle !== 'none' ||
      chunks.length > 1;
    if (!animationsActive) {
      setTNowSec(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    let last = 0;
    const step = (now: number) => {
      if (now - last >= PREVIEW_FRAME_INTERVAL_MS) {
        const elapsed = (now - start) / 1000;
        const t = elapsed % props.durationSec;
        setTNowSec(t);
        last = now;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [
    props.durationSec,
    props.motionPreset,
    props.animationPreset,
    props.reactiveMode,
    props.fxPreset,
    props.template.showWaveform,
    props.template.progressBarStyle,
    chunks.length,
  ]);

  // Pick the chunk active at tNowSec (or use forcedChunkIndex when scrubbing).
  const activeIdx = useMemo(() => {
    if (props.forcedChunkIndex != null) {
      return Math.max(0, Math.min(chunks.length - 1, props.forcedChunkIndex));
    }
    if (chunks.length === 0) return -1;
    for (let i = 0; i < chunks.length; i++) {
      if (tNowSec >= chunks[i].start && tNowSec < chunks[i].end) return i;
    }
    // Past the last chunk — keep showing it during exit.
    return chunks.length - 1;
  }, [chunks, tNowSec, props.forcedChunkIndex]);

  const currentLyric = activeIdx >= 0 ? chunks[activeIdx].line : null;

  // Compute animation state at this moment of the active chunk.
  const animState = useMemo(() => {
    if (activeIdx < 0) return REST_STATE;
    const chunk = chunks[activeIdx];
    const dur = Math.max(0, chunk.end - chunk.start);
    const tInChunk = tNowSec - chunk.start;
    return animationStateAt(props.animationPreset, dur, tInChunk);
  }, [activeIdx, chunks, tNowSec, props.animationPreset]);

  // Sample reactive state from the pre-computed amplitude curve at the same
  // tNowSec — same value the export pipeline will see at the equivalent
  // keyframe sample time.
  const reactiveState = useMemo(
    () => reactiveStateAt(props.reactiveMode, props.amplitudeCurve, tNowSec),
    [props.reactiveMode, props.amplitudeCurve, tNowSec],
  );

  const fxConfig = useMemo(() => fxConfigForPreset(props.fxPreset), [props.fxPreset]);
  // Same seed convention as overlays.ts so animated grain/dust agree across
  // preview and export at corresponding moments (50ms resolution).
  const fxSeed = Math.round(tNowSec * 1000) | 0;

  // Karaoke progress = position within the active chunk, 0..1.
  const karaoke = useMemo(() => {
    if (!props.karaokeEnabled || activeIdx < 0) return undefined;
    const chunk = chunks[activeIdx];
    const dur = Math.max(0, chunk.end - chunk.start);
    const p = dur > 0 ? Math.max(0, Math.min(1, (tNowSec - chunk.start) / dur)) : 0;
    return { enabled: true, progress: p };
  }, [props.karaokeEnabled, activeIdx, chunks, tNowSec]);

  const timeRatio = props.durationSec > 0 ? tNowSec / props.durationSec : 0;

  // Repaint on every state change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = SCENE_W;
    canvas.height = SCENE_H;
    ctx.clearRect(0, 0, SCENE_W, SCENE_H);
    renderScene(ctx, {
      width: SCENE_W,
      height: SCENE_H,
      template: props.template,
      language: props.language,
      highlightSub: props.highlightSub,
      exportMode: false,
      lyric: currentLyric,
      trackTitle: props.trackTitle,
      artistName: props.artistName,
      photo,
      backgroundPhoto: bgPhoto,
      timeRatio,
      motionPreset: props.motionPreset,
      animation: animState,
      reactive: reactiveState,
      fxConfig,
      fxSeed,
      karaoke,
      lyricPositionOverride: props.lyricPositionOverride,
      fontKey: props.fontKey,
      watermark: props.watermark ?? null,
      styleOverrides: props.styleOverrides ?? null,
      durationSec: props.durationSec,
    });
    // Safe-zone overlay — preview-only. Painted last so it sits on top
    // of every other layer, including grain.
    if (props.safeZone?.enabled) {
      paintSafeZones(ctx, SCENE_W, SCENE_H, props.safeZone.platform);
    }
  }, [
    photo,
    bgPhoto,
    currentLyric,
    props.template,
    props.language,
    props.highlightSub,
    props.trackTitle,
    props.artistName,
    props.motionPreset,
    timeRatio,
    animState,
    reactiveState,
    fxConfig,
    fxSeed,
    karaoke,
    props.safeZone,
    props.lyricPositionOverride,
    props.fontKey,
    props.watermark,
    props.styleOverrides,
  ]);

  return (
    <div className="flex h-full w-full items-center justify-center">
      <canvas
        ref={canvasRef}
        className="max-h-full max-w-full rounded-2xl shadow-2xl"
        style={{ aspectRatio: '9 / 16', height: '100%', objectFit: 'contain' }}
      />
    </div>
  );
}
