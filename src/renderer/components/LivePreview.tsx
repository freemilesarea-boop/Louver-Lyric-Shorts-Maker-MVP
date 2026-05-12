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
import { renderScene, SCENE_W, SCENE_H, type ScenePhoto } from '../../shared/scene';
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
  /** Phase 5-6.1: kind of the main media src above. Drives whether we
   *  load it as an HTMLImageElement (image/gif) or HTMLVideoElement
   *  (video). The src may be a `data:` URL (small images) or a
   *  `media://` URL (everything else); both element types accept both. */
  mainMediaKind?: import('../../shared/types').MediaKind;
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
  /** Phase 5-8.1 — Fires whenever the inner <video> element errors or
   *  the 5s canplay watchdog trips. The parent (EditorScreen) uses it
   *  to surface the MediaValidationBanner with forceShow=true so the
   *  user gets the same one-click transcode UX they had on Start. */
  onVideoUnsupported?: () => void;
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
  const [photo, setPhoto] = useState<ScenePhoto | null>(null);
  const [bgPhoto, setBgPhoto] = useState<ScenePhoto | null>(null);
  const [tNowSec, setTNowSec] = useState(0);
  /** Phase 5-8 — surface video load failures + timeouts to the user
   *  instead of sitting on "영상 로딩 중..." forever. Cleared whenever
   *  the user picks a new src. */
  const [videoError, setVideoError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.imageDataUrl) {
      setPhoto(null);
      setVideoError(null);
      return;
    }
    if (props.mainMediaKind === 'video') {
      // Video kind: stream into an off-DOM HTMLVideoElement and let
      // canvas drawImage paint the current frame each repaint. We copy
      // videoWidth/videoHeight onto the element's width/height so
      // renderScene's fitContain math (which reads .width/.height)
      // works. The video plays muted on a loop so the canvas always
      // has fresh frames; the time loop further down also bumps a tick
      // at ~30fps so even on the slowest preview path the canvas keeps
      // pulling new content out of the video element.
      //
      // Phase 5-8 — we now wait for `canplay` (not just `loadedmetadata`)
      // before considering the video ready. metadata alone fires before
      // any frame is decodable, so previous builds painted a blank
      // canvas and the user saw "영상 로딩 중..." indefinitely while
      // the decoder waited on Range data. A 10s watchdog surfaces a
      // concrete error if loading stalls, so the user can re-pick the
      // file or report it.
      const v = document.createElement('video');
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.crossOrigin = 'anonymous';
      let cancelled = false;
      setVideoError(null);

      const debugSnapshot = (tag: string) => {
        // eslint-disable-next-line no-console
        console.log(
          `[video:${tag}]`,
          'src=',
          props.imageDataUrl?.slice(0, 60),
          'readyState=',
          v.readyState,
          'networkState=',
          v.networkState,
          'videoWidth=',
          v.videoWidth,
          'videoHeight=',
          v.videoHeight,
          'currentTime=',
          v.currentTime,
          'duration=',
          v.duration,
          'errorCode=',
          v.error?.code,
        );
      };

      const onCanPlay = () => {
        if (cancelled) return;
        v.width = v.videoWidth;
        v.height = v.videoHeight;
        v.play().catch((e) => {
          // eslint-disable-next-line no-console
          console.warn('[video] play() rejected:', e);
        });
        setPhoto(v);
        setVideoError(null);
        debugSnapshot('canplay');
      };
      // Phase 5-8.6 — log EVERY <video> event the spec defines (per
      // user spec). Helps root-cause future "stuck on loading"
      // reports — the user can paste the console log and see exactly
      // which event last fired and the readyState/networkState at
      // that moment.
      const trace = (tag: string) => () => debugSnapshot(tag);
      v.addEventListener('loadstart', trace('loadstart'));
      v.addEventListener('loadedmetadata', trace('loadedmetadata'));
      v.addEventListener('loadeddata', trace('loadeddata'));
      v.addEventListener('canplaythrough', trace('canplaythrough'));
      v.addEventListener('stalled', trace('stalled'));
      v.addEventListener('suspend', trace('suspend'));
      v.addEventListener('abort', trace('abort'));
      v.addEventListener('emptied', trace('emptied'));
      v.addEventListener('canplay', onCanPlay);
      v.addEventListener('error', () => {
        if (cancelled) return;
        const e = v.error;
        const msg = e
          ? `code=${e.code} ${e.message || mediaErrorLabel(e.code)}`
          : 'unknown';
        // eslint-disable-next-line no-console
        console.error('[video] error event:', msg);
        debugSnapshot('error');
        setVideoError(`영상 로딩 실패 (${msg})`);
        setPhoto(null);
        // Phase 5-8.1: code 4 = MEDIA_ERR_SRC_NOT_SUPPORTED. The most
        // common cause is an HEVC / ProRes / 10-bit pixel-format
        // source. Hand the signal to the parent so its
        // MediaValidationBanner pops with detected info + transcode.
        props.onVideoUnsupported?.();
      });
      v.src = props.imageDataUrl;
      // Force the network start — some Chromium builds defer until the
      // element is attached to the DOM, which we never do.
      v.load();

      // Phase 5-8.5: 10s watchdog (per user spec). Some genuinely
      // valid sources take a few seconds to negotiate the first
      // canplay event, especially when the moov atom is at the end
      // and Chromium has to re-fetch from a tail Range. 5s was
      // catching false positives. Probe `v.readyState` directly
      // (canonical source of truth) instead of the stale React
      // `photo` closure.
      const watchdog = window.setTimeout(() => {
        if (cancelled) return;
        debugSnapshot('watchdog');
        if (v.readyState < 3 /* HAVE_FUTURE_DATA */) {
          setVideoError(
            '영상 로딩이 10초 안에 시작되지 않았어요. 코덱 호환성 문제일 가능성이 높습니다. 오른쪽 안내의 "변환하기"를 눌러보세요.',
          );
          props.onVideoUnsupported?.();
        }
      }, 10000);

      return () => {
        cancelled = true;
        window.clearTimeout(watchdog);
        v.removeEventListener('canplay', onCanPlay);
        try {
          v.pause();
        } catch {
          /* noop */
        }
        v.removeAttribute('src');
        v.load();
      };
    }
    // image / gif: HTMLImageElement handles both, including animated
    // GIFs (Chromium animates the bitmap as we drawImage in rAF — but
    // only as long as something repaints the canvas, hence the time
    // loop below also engages for `gif`).
    const img = new Image();
    img.onload = () => setPhoto(img);
    img.onerror = () => {
      // eslint-disable-next-line no-console
      console.error('[image] load failed for src=', props.imageDataUrl?.slice(0, 60));
      setPhoto(null);
    };
    img.src = props.imageDataUrl;
  }, [props.imageDataUrl, props.mainMediaKind]);

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
      chunks.length > 1 ||
      // GIF + video both need the canvas to keep repainting so the
      // visible frame advances. For GIF, Chromium drives the bitmap
      // animation but only repaints when drawImage is called — without
      // a tick, the canvas freezes on the first frame.
      props.mainMediaKind === 'video' ||
      props.mainMediaKind === 'gif';
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
    props.mainMediaKind,
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
      {/* Phase 5-8.3 — short pill overlay only. The detailed
       *  explanation + convert button live in MediaValidationBanner
       *  in the right control column where the layout has 500px to
       *  work with. Cramming the long copy into a narrow preview
       *  column made the button effectively unreachable on small
       *  windows. */}
      {props.mainMediaKind === 'video' && props.imageDataUrl && (videoError || !photo) && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 text-xs">
          <div
            className={[
              'whitespace-nowrap rounded-full px-3 py-1 shadow-lg',
              videoError
                ? 'bg-red-500/90 text-white'
                : 'bg-ink-950/80 text-white/70',
            ].join(' ')}
          >
            {videoError
              ? '영상 미리보기 실패 — 오른쪽 안내에서 변환하세요'
              : '영상 로딩 중...'}
          </div>
        </div>
      )}
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
 * Drag overlay — absolutely-positioned to exactly cover the canvas's
 * client-rect. Tracks resize via ResizeObserver so handles stay aligned
 * after window resize / sidebar collapse / browser zoom. Handles are
 * intentionally large and high-contrast so they're easy to grab.
 *
 * Coordinate model: handles store their position in CANONICAL 1080×1920
 * space; on render we map → CSS pixels via the live canvas rect; on
 * mousemove we map deltas back from CSS pixels → canonical via the
 * same rect. The mapping is symmetric so the round-trip stays stable.
 *
 * Phase 5-5.1 fix: previous version read the canvas rect once per
 * render and never observed resize. If the canvas wasn't laid out at
 * mount time the rect was zero → handles never appeared. Now we
 * observe + restate the rect, and we render a giant placeholder handle
 * even before the rect is known so the user always sees the toggle is
 * active.
 */
type LayoutKey = 'lyric' | 'meta' | 'waveform';

/**
 * Friendly label for HTMLMediaElement.error.code values. Mirrors the
 * HTML spec — codes 1-4 are the only values that ever surface.
 */
function mediaErrorLabel(code: number | undefined): string {
  switch (code) {
    case 1: return 'aborted';
    case 2: return 'network error';
    case 3: return 'decode error (codec not supported?)';
    case 4: return 'source not supported (mime / format mismatch)';
    default: return 'unknown';
  }
}

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
  // Track the canvas's CSS box. Updates on mount, on every resize,
  // and on window scroll so cross-pane absolute positioning stays
  // accurate while the user is interacting.
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const canvas = props.canvasRef.current;
    if (!canvas) return;
    const update = () => setRect(canvas.getBoundingClientRect());
    update();
    const ro = new ResizeObserver(update);
    ro.observe(canvas);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [props.canvasRef]);

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

  const draggingRef = useRef<{
    key: LayoutKey;
    rect: DOMRect;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const onPointerDown = (key: LayoutKey, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const canvas = props.canvasRef.current;
    if (!canvas) return;
    const live = canvas.getBoundingClientRect();
    draggingRef.current = {
      key,
      rect: live,
      startX: e.clientX,
      startY: e.clientY,
      originX: positions[key].x,
      originY: positions[key].y,
    };
    const onMove = (mv: PointerEvent) => {
      const d = draggingRef.current;
      if (!d) return;
      const dxCanvas = ((mv.clientX - d.startX) / d.rect.width) * SCENE_W;
      const dyCanvas = ((mv.clientY - d.startY) / d.rect.height) * SCENE_H;
      props.onChange(d.key, {
        x: d.originX + dxCanvas,
        y: d.originY + dyCanvas,
      });
    };
    const onUp = () => {
      draggingRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const handles: Array<{ key: LayoutKey; label: string; show: boolean }> = [
    { key: 'lyric', label: '가사', show: true },
    { key: 'meta', label: '곡 정보', show: props.showMeta },
    { key: 'waveform', label: '웨이브폼', show: props.showWaveform },
  ];

  // Position the overlay box exactly on top of the canvas's client rect
  // — using `position: fixed` so it's not affected by ancestor flex /
  // overflow. We anchor in viewport coordinates derived from the
  // canvas rect, which we keep current via ResizeObserver.
  const overlayStyle: React.CSSProperties = rect
    ? {
        position: 'fixed',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        pointerEvents: 'none',
        zIndex: 30,
      }
    : { position: 'fixed', left: 0, top: 0, width: 0, height: 0 };

  return (
    <div style={overlayStyle}>
      {rect &&
        handles
          .filter((h) => h.show)
          .map((h) => {
            const p = positions[h.key];
            const left = (p.x / SCENE_W) * rect.width;
            const top = (p.y / SCENE_H) * rect.height;
            return (
              <button
                key={h.key}
                onPointerDown={(e) => onPointerDown(h.key, e)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  props.onChange(h.key, undefined);
                }}
                title="드래그해서 위치 옮기기 · 더블클릭하면 기본값으로 돌아갑니다"
                className="absolute select-none rounded-full border-2 border-yellow-300 bg-yellow-400/85 px-3 py-1 text-[12px] font-bold text-black shadow-lg hover:bg-yellow-300"
                style={{
                  left,
                  top,
                  transform: 'translate(-50%, -50%)',
                  pointerEvents: 'auto',
                  cursor: 'grab',
                  touchAction: 'none',
                  minWidth: 64,
                  minHeight: 28,
                }}
              >
                ⋮⋮ {h.label}
              </button>
            );
          })}
    </div>
  );
}
