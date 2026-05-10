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
  /** Per-element drag positions. Null/empty = template defaults. */
  layoutOverrides?: import('../../shared/types').LayoutOverrides | null;
  /** When true the preview shows drag handles + accepts drag input.
   *  Wired to the project store's layoutEditMode. */
  layoutEditMode?: boolean;
  /** Called when the user drags an element. The component passes the
   *  element key + the new position in canonical 1080×1920 coordinates;
   *  the parent persists into the store. */
  onLayoutChange?: (
    key: 'lyric' | 'meta' | 'waveform',
    point: { x: number; y: number } | undefined,
  ) => void;
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
      layoutOverrides: props.layoutOverrides ?? null,
      amplitudeCurve: props.amplitudeCurve ?? null,
      tNowSec,
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
    props.layoutOverrides,
  ]);

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <canvas
        ref={canvasRef}
        className="max-h-full max-w-full rounded-2xl shadow-2xl"
        style={{ aspectRatio: '9 / 16', height: '100%', objectFit: 'contain' }}
      />
      {props.layoutEditMode && props.onLayoutChange && (
        <DragOverlay
          canvasRef={canvasRef}
          template={props.template}
          layoutOverrides={props.layoutOverrides ?? null}
          lyricPositionOverride={props.lyricPositionOverride}
          showWaveform={props.template.showWaveform}
          showMeta={
            !!(props.trackTitle?.trim() || props.artistName?.trim())
          }
          onChange={props.onLayoutChange}
        />
      )}
    </div>
  );
}

/**
 * Drag overlay — absolutely-positioned over the canvas, shows a labeled
 * handle for each draggable element at its current effective position.
 * Mousedown captures the element; mousemove maps client-pixel deltas
 * back to canvas-pixel coordinates (1080×1920) via the canvas's
 * bounding-rect ratio so positions persist correctly regardless of how
 * the canvas is CSS-scaled in the editor.
 *
 * Phase 5-5 supports lyric / meta / waveform. Adding more elements is a
 * matter of extending the LAYOUT_KEYS array + the LayoutOverrides type.
 */
type LayoutKey = 'lyric' | 'meta' | 'waveform';

function DragOverlay(props: {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  template: Template;
  layoutOverrides: import('../../shared/types').LayoutOverrides | null;
  lyricPositionOverride: LyricPosition | null;
  showWaveform: boolean;
  showMeta: boolean;
  onChange: (
    key: LayoutKey,
    point: { x: number; y: number } | undefined,
  ) => void;
}): JSX.Element {
  // Compute the effective position of each element in canonical 1080×1920
  // coordinates. Drag override wins; otherwise we derive from template.
  const lyricY = (() => {
    const eff =
      props.lyricPositionOverride ?? props.template.lyricPosition;
    switch (eff) {
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

  const positions: Record<LayoutKey, { x: number; y: number }> = {
    lyric: props.layoutOverrides?.lyric ?? { x: SCENE_W / 2, y: lyricY },
    meta: props.layoutOverrides?.meta ?? {
      x: SCENE_W / 2,
      y: Math.round(SCENE_H * 0.78),
    },
    waveform: props.layoutOverrides?.waveform ?? {
      x: SCENE_W / 2,
      y: Math.round(SCENE_H * 0.84),
    },
  };

  // Convert canonical (canvasX, canvasY) to CSS-pixel offset within the
  // overlay (which exactly tracks the canvas). The canvas CSS size is
  // whatever the layout gave it; we read the live rect each time.
  const toCss = (
    canvasX: number,
    canvasY: number,
    rect: DOMRect,
  ): { left: number; top: number } => ({
    left: (canvasX / SCENE_W) * rect.width,
    top: (canvasY / SCENE_H) * rect.height,
  });

  // Drag state lives in refs so we don't churn React renders during
  // mousemove. The on-screen handle position updates via inline style
  // by reading the latest layoutOverrides from props on each render.
  const draggingRef = useRef<{
    key: LayoutKey;
    rect: DOMRect;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const onMouseDown = (key: LayoutKey, e: React.MouseEvent) => {
    e.preventDefault();
    const canvas = props.canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    draggingRef.current = {
      key,
      rect,
      startX: e.clientX,
      startY: e.clientY,
      originX: positions[key].x,
      originY: positions[key].y,
    };
    const onMove = (mv: MouseEvent) => {
      const d = draggingRef.current;
      if (!d) return;
      // Map client-pixel deltas to canonical 1080×1920 deltas using the
      // current canvas CSS size — handles any window resize or zoom.
      const dxCanvas = ((mv.clientX - d.startX) / d.rect.width) * SCENE_W;
      const dyCanvas = ((mv.clientY - d.startY) / d.rect.height) * SCENE_H;
      props.onChange(d.key, {
        x: d.originX + dxCanvas,
        y: d.originY + dyCanvas,
      });
    };
    const onUp = () => {
      draggingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handles: Array<{ key: LayoutKey; label: string; show: boolean }> = [
    { key: 'lyric', label: '가사', show: true },
    { key: 'meta', label: '곡 정보', show: props.showMeta },
    { key: 'waveform', label: '웨이브폼', show: props.showWaveform },
  ];

  // The overlay covers the same box as the canvas. We re-read the rect
  // on every render so resizing the editor pane keeps handles aligned.
  const canvas = props.canvasRef.current;
  const rect = canvas?.getBoundingClientRect();

  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
      style={{ aspectRatio: '9 / 16' }}
    >
      <div
        className="relative h-full"
        style={{ aspectRatio: '9 / 16' }}
      >
        {rect &&
          handles
            .filter((h) => h.show)
            .map((h) => {
              const p = positions[h.key];
              const css = toCss(p.x, p.y, rect);
              return (
                <button
                  key={h.key}
                  onMouseDown={(e) => onMouseDown(h.key, e)}
                  onDoubleClick={() => props.onChange(h.key, undefined)}
                  title="드래그해서 위치 옮기기 · 더블클릭으로 초기화"
                  className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 select-none rounded-full border border-accent bg-accent/30 px-2 py-0.5 text-[10px] font-semibold text-white shadow-md backdrop-blur-sm hover:bg-accent/50"
                  style={{ left: css.left, top: css.top, cursor: 'move' }}
                >
                  ⋮⋮ {h.label}
                </button>
              );
            })}
      </div>
    </div>
  );
}
