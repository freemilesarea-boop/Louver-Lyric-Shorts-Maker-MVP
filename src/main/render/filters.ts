import type { MotionPreset, Template } from '../../shared/types';
import { ffmpegMotionExpressions, isStaticMotion } from '../../shared/motion';

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

  // --- 5) Progress bar ---
  if (t.progressBarStyle !== 'none') {
    const margin = 80;
    const barY = Math.round(H * 0.88);
    const fullW = W - margin * 2;
    const barH = t.progressBarStyle === 'thick' ? 10 : 6;
    lines.push(
      `[${chainIn}]drawbox=x=${margin}:y=${barY}:w=${fullW}:h=${barH}:` +
        `color=${ffmpegColor(t.lyricColor, 0.25)}:t=fill[track]`,
    );
    lines.push(
      `[track]drawbox=x=${margin}:y=${barY}:` +
        `w='min(${fullW},${fullW}*t/${a.durationSec})':h=${barH}:` +
        `color=${ffmpegColor(t.lyricColor, 0.95)}:t=fill:replace=1[bar]`,
    );
    chainIn = 'bar';
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
