import type { MotionPreset, Template } from '../../shared/types';
import { ffmpegMotionExpressions, isStaticMotion } from '../../shared/motion';
import type { ProgressBarGeom } from '../../shared/playerChrome';

export interface OverlayTiming {
  /** Index into ffmpeg input list (0 = image, 1 = audio, 2..N = overlays). */
  inputIndex: number;
  startSec: number;
  endSec: number;
}

export interface FilterArgs {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  template: Template;
  overlays: OverlayTiming[];
  /** Effective motion preset for this render. */
  motionPreset: MotionPreset;
  /** When set, the background uses this ffmpeg input index instead of
   *  splitting input 0. Lets the user pick a separate background image.
   *  Phase 5-3: image only. Video/GIF defer to Phase 5-4. */
  backgroundInputIndex?: number | null;
  /** User scale on the foreground card (0.6..1.2). 1 = template default
   *  (matches scene.ts resolvePhotoBox 92%×74%). */
  mainScale?: number;
  /** Geometry of the player-chrome progress bar (when the template has
   *  one). When provided, ffmpeg drawbox paints a smooth per-frame bar
   *  here using a t/dur expression; the chrome PNG painter skips its
   *  own progress in export mode to avoid double-drawing. */
  playerProgressGeom?: ProgressBarGeom | null;
}

/**
 * Build an ffmpeg filter graph for a 9:16 lyric short.
 *
 * Layers (bottom → top):
 *   1. Background  : input image scaled to cover, blurred + tinted
 *   2. Foreground  : input image scaled to fit, centered card
 *   3. Tint        : full-frame solid (template-driven alpha)
 *   4. Lyric/meta  : pre-rendered transparent PNG overlays (one per chunk)
 *   5. Progress    : drawbox with time-varying width
 *   6. Play icon   : drawbox triangle approximation (template-gated)
 *   7. Waveform    : faux waveform via repeated drawbox blocks (template-gated)
 *
 * NOTE: We avoid `drawtext` entirely. The static ffmpeg builds bundled with
 * `ffmpeg-static` do not always include drawtext, and pre-rendering the text
 * to PNGs in the renderer also gives us pixel-perfect parity with the live
 * HTML preview.
 */
export function buildFilterGraph(a: FilterArgs): string {
  const W = a.width;
  const H = a.height;
  const t = a.template;
  const lines: string[] = [];

  // --- 1) Background (cover + effect) and 2) Foreground (centered fit) ---
  // When the user picked a separate background image, use that input as
  // the background source and feed input 0 (main image) directly to the
  // foreground. Otherwise split input 0 into both layers (legacy single-
  // image flow).
  if (a.backgroundInputIndex != null) {
    lines.push(
      `[${a.backgroundInputIndex}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,` +
        `crop=${W}:${H},` +
        bgEffectChain(t.backgroundEffect) +
        `[bg]`,
    );
    lines.push(`[0:v]copy[src2]`);
  } else {
    lines.push(`[0:v]split=2[src1][src2]`);
    lines.push(
      `[src1]scale=${W}:${H}:force_original_aspect_ratio=increase,` +
        `crop=${W}:${H},` +
        bgEffectChain(t.backgroundEffect) +
        `[bg]`,
    );
  }
  // Foreground card geometry — must match scene.ts resolvePhotoBox so
  // preview and export agree pixel-for-pixel. Phase 5-3 raised both
  // dimensions and added a user scale override.
  const safeScale = Math.max(0.6, Math.min(1.2, a.mainScale ?? 1));
  const cardW = Math.round(W * 0.92 * safeScale);
  const cardH = Math.round(H * 0.74 * safeScale);

  // Foreground card: when motion is static, keep the legacy fit-contain
  // behavior so the user's photo is shown in full (with letterboxing if its
  // aspect ratio doesn't match the card). For any non-static preset, switch
  // to cover-crop and pipe through `zoompan` so the visible window animates.
  if (isStaticMotion(a.motionPreset)) {
    lines.push(
      `[src2]scale=${cardW}:${cardH}:force_original_aspect_ratio=decrease[fg]`,
    );
  } else {
    const m = ffmpegMotionExpressions(a.motionPreset, a.durationSec, a.fps);
    // zoompan's `d=` is frames-per-input-frame. We feed a continuous loop of
    // identical frames and want a 1:1 mapping (one output per input), with
    // the duration normalizer baked into the z/x/y expressions via `on`.
    // Setting d=1 avoids the input×d frame multiplication bug.
    lines.push(
      `[src2]scale=${cardW}:${cardH}:force_original_aspect_ratio=increase,` +
        `crop=${cardW}:${cardH},` +
        `zoompan=z='${m.zExpr}':x='${m.xExpr}':y='${m.yExpr}':` +
        `d=1:s=${cardW}x${cardH}:fps=${a.fps}[fg]`,
    );
    void m.durationFrames;
  }

  // Vertical offset matches scene.ts resolvePhotoBox: y = (H-h)/2 - 100.
  lines.push(`[bg][fg]overlay=(W-w)/2:(H-h)/2-100[stage0]`);

  // --- 3) Tint overlay ---
  let chainIn = 'stage0';
  if (t.overlayOpacity > 0) {
    lines.push(
      `[stage0]drawbox=x=0:y=0:w=${W}:h=${H}:` +
        `color=${ffmpegColor(t.cardBg, t.overlayOpacity * 0.25)}:t=fill[stage1]`,
    );
    chainIn = 'stage1';
  }

  // --- 4) Lyric / meta PNG overlays ---
  a.overlays.forEach((ov, idx) => {
    const out = `ov${idx}`;
    lines.push(
      `[${chainIn}][${ov.inputIndex}:v]overlay=0:0:` +
        `enable='between(t,${ov.startSec.toFixed(3)},${ov.endSec.toFixed(3)})'` +
        `[${out}]`,
    );
    chainIn = out;
  });

  // --- 5) Default progress bar (bottom of canvas, y≈H*0.88) ---
  // Skipped when the template ships a playerChrome — chrome has its own
  // progress bar inside the card (§6.5). Drawing both would put two
  // bars on screen at different y positions.
  //
  // Phase 5-5.1: ffmpeg 7.0.2's drawbox does NOT evaluate `w` expressions
  // per-frame. The expression is computed at filter init (where t=0 →
  // w=0, falling back to the "0 means full width" default), producing a
  // static full-width bar. Verified via `-vf "drawbox=w=200*t..."` →
  // ffmpeg logged `w:1080` at parse time and the rendered bar was full
  // width regardless of t.
  // Workaround: emit a series of stacked drawbox calls each gated by
  // `enable=between(t,a,b)` for a time slice. Each slice has a fixed
  // pre-computed width corresponding to that slice's progress fraction.
  // 4fps step rate = 250ms per slice = visually smooth + low filter
  // graph cost (e.g. 24 boxes for a 6s clip, 60 for 15s).
  if (t.progressBarStyle !== 'none' && !t.playerChrome) {
    const margin = 80;
    const barY = Math.round(H * 0.88);
    const fullW = W - margin * 2;
    const barH = t.progressBarStyle === 'thick' ? 10 : 6;
    // Track background — full width, low alpha — drawn once.
    lines.push(
      `[${chainIn}]drawbox=x=${margin}:y=${barY}:w=${fullW}:h=${barH}:` +
        `color=${ffmpegColor(t.lyricColor, 0.25)}:thickness=fill[track]`,
    );
    chainIn = 'track';
    // Stacked filled bars — one per 250ms slice. Each slice's width
    // matches the END of that slice's progress so the bar appears to
    // grow forward (not pop back).
    const sliceSec = 0.25;
    const slices = Math.max(1, Math.ceil(a.durationSec / sliceSec));
    for (let i = 0; i < slices; i++) {
      const tStart = i * sliceSec;
      const tEnd = Math.min(a.durationSec, (i + 1) * sliceSec);
      const ratio = Math.min(1, tEnd / a.durationSec);
      const w = Math.max(1, Math.round(fullW * ratio));
      const out = `pb${i}`;
      lines.push(
        `[${chainIn}]drawbox=x=${margin}:y=${barY}:w=${w}:h=${barH}:` +
          `color=${ffmpegColor(t.lyricColor, 0.95)}:thickness=fill:` +
          `enable='between(t,${tStart.toFixed(3)},${tEnd.toFixed(3)})'[${out}]`,
      );
      chainIn = out;
    }
  }

  // --- 6) Play / pause icon (cheap triangle from drawboxes) ---
  if (t.showPlayerControl) {
    const cx = W / 2;
    const cy = Math.round(H * 0.93);
    lines.push(
      `[${chainIn}]drawbox=x=${Math.round(cx - 18)}:y=${cy - 18}:w=8:h=36:` +
        `color=${ffmpegColor(t.lyricColor, 0.95)}:t=fill[ic1]`,
    );
    lines.push(
      `[ic1]drawbox=x=${Math.round(cx - 4)}:y=${cy - 12}:w=8:h=24:` +
        `color=${ffmpegColor(t.lyricColor, 0.95)}:t=fill[ic2]`,
    );
    lines.push(
      `[ic2]drawbox=x=${Math.round(cx + 8)}:y=${cy - 6}:w=8:h=12:` +
        `color=${ffmpegColor(t.lyricColor, 0.95)}:t=fill[ic3]`,
    );
    chainIn = 'ic3';
  }

  // --- 6.5) Player-chrome progress bar — same time-sliced approach as
  //          §5 (see comment there for why drawbox-with-expression
  //          doesn't work in ffmpeg 7.0.2).
  //          Slices at 4fps = 250ms apart; each slice has a fixed width
  //          and a fixed playhead-dot x. The PNG-baked chrome painter
  //          skips its own progress bar in export mode (skipProgress=
  //          true) so this is the only on-screen progress for player
  //          chrome templates.
  if (t.playerChrome && a.playerProgressGeom) {
    const g = a.playerProgressGeom;
    const accent = t.lyricSubColor;
    const fg = t.lyricColor;
    // Track background — full width, low alpha — drawn once.
    lines.push(
      `[${chainIn}]drawbox=x=${g.x}:y=${g.y}:w=${g.w}:h=${g.h}:` +
        `color=${ffmpegColor(fg, 0.18)}:thickness=fill[pc_track]`,
    );
    chainIn = 'pc_track';
    // Stacked filled bars + dots, one per 250ms slice.
    const dotSize = Math.max(8, g.h * 3);
    const dotY = g.y + Math.round(g.h / 2 - dotSize / 2);
    const sliceSec = 0.25;
    const slices = Math.max(1, Math.ceil(a.durationSec / sliceSec));
    for (let i = 0; i < slices; i++) {
      const tStart = i * sliceSec;
      const tEnd = Math.min(a.durationSec, (i + 1) * sliceSec);
      const ratio = Math.min(1, tEnd / a.durationSec);
      const w = Math.max(1, Math.round(g.w * ratio));
      const dotX = Math.max(g.x, g.x + w - Math.round(dotSize / 2));
      const enable = `enable='between(t,${tStart.toFixed(3)},${tEnd.toFixed(3)})'`;
      const barOut = `pcb${i}`;
      lines.push(
        `[${chainIn}]drawbox=x=${g.x}:y=${g.y}:w=${w}:h=${g.h}:` +
          `color=${ffmpegColor(accent, 0.95)}:thickness=fill:${enable}[${barOut}]`,
      );
      const dotOut = `pcd${i}`;
      lines.push(
        `[${barOut}]drawbox=x=${dotX}:y=${dotY}:w=${dotSize}:h=${dotSize}:` +
          `color=${ffmpegColor(fg, 1)}:thickness=fill:${enable}[${dotOut}]`,
      );
      chainIn = dotOut;
    }
  }

  // --- 7) Faux waveform ---
  if (t.showWaveform) {
    const bars = 32;
    const margin = 100;
    const baseY = Math.round(H * 0.84);
    const region = W - margin * 2;
    const slot = Math.floor(region / bars);
    for (let i = 0; i < bars; i++) {
      const seed = (i * 37) % 100;
      const heightExpr = `clip(${seed}/100*40+30+20*sin(t*3+${i}*0.7),12,80)`;
      const x = margin + i * slot;
      const out = `wf${i}`;
      lines.push(
        `[${chainIn}]drawbox=x=${x}:y='${baseY}-(${heightExpr})/2':` +
          `w=${Math.max(2, slot - 4)}:h='${heightExpr}':` +
          `color=${ffmpegColor(t.lyricColor, 0.85)}:t=fill:replace=1[${out}]`,
      );
      chainIn = out;
    }
  }

  // Final output label.
  lines.push(`[${chainIn}]format=yuv420p,fps=${a.fps}[vout]`);
  return lines.join(';\n');
}

function bgEffectChain(effect: Template['backgroundEffect']): string {
  switch (effect) {
    case 'blur':
      return 'boxblur=20:5,eq=brightness=-0.05:saturation=1.05';
    case 'darken':
      return 'boxblur=8:3,eq=brightness=-0.25:saturation=0.95';
    case 'sepia':
      return (
        'boxblur=12:3,eq=brightness=-0.05:saturation=0.6,' +
        'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131'
      );
    case 'none':
    default:
      return 'boxblur=4:2';
  }
}

function ffmpegColor(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const cleaned = hex.startsWith('#') ? hex.slice(1) : hex;
  return `0x${cleaned}@${a.toFixed(3)}`;
}
