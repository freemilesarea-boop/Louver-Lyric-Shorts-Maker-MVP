import type { MotionPreset } from './types';

/**
 * Photo motion (Ken Burns–style).
 *
 * MOTION MODEL
 * ============
 * Motion is described by two animated quantities sampled at a normalized
 * time `r ∈ [0, 1]` over the clip's duration:
 *
 *   - `scale`  ≥ 1   : how much to zoom in. 1 = full source visible,
 *                       1.08 = 8% zoom-in (visible window is 1/1.08 of source).
 *   - `offsetX/Y` ∈ [-1, 1] : where the visible window sits within the
 *                              "available room" left over by the zoom.
 *                              0 = centered. ±1 = at the boundary.
 *
 * Both the canvas preview and the ffmpeg `zoompan` expressions are derived
 * from this model so they stay in lock-step.
 *
 * The motion is applied to the **foreground card only** — frame decorations
 * (polaroid border, cassette body, neon outline, etc.) stay screen-anchored
 * so the photo "moves inside" the frame. This is the standard Ken Burns look
 * and avoids the frame-vs-photo desync that would happen if we panned the
 * whole composite.
 */

export interface MotionState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const PI = Math.PI;

export function motionAt(preset: MotionPreset, ratio: number): MotionState {
  const r = clamp(ratio, 0, 1);
  switch (preset) {
    case 'none':
      return { scale: 1, offsetX: 0, offsetY: 0 };
    case 'slow_zoom_in':
      return { scale: 1 + 0.08 * r, offsetX: 0, offsetY: 0 };
    case 'slow_zoom_out':
      return { scale: 1.08 - 0.08 * r, offsetX: 0, offsetY: 0 };
    case 'pan_left':
      return { scale: 1.08, offsetX: 0.7 - 1.4 * r, offsetY: 0 };
    case 'pan_right':
      return { scale: 1.08, offsetX: -0.7 + 1.4 * r, offsetY: 0 };
    case 'float_soft':
      return {
        scale: 1.04 + 0.015 * Math.sin(r * 2 * PI),
        offsetX: 0.3 * Math.sin(r * 4 * PI),
        offsetY: 0.2 * Math.cos(r * 2 * PI),
      };
  }
}

/** Whether this preset ever leaves scale=1 / offset=0. Used to skip work. */
export function isStaticMotion(preset: MotionPreset): boolean {
  return preset === 'none';
}

/**
 * Draw `img` into the destination box (dx, dy, dw, dh) using cover-crop
 * sampling adjusted by `motion`. The destination box is the screen-anchored
 * card area; the photo zooms/pans within those bounds.
 */
export function drawImageWithMotion(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  motion: MotionState,
): void {
  if (img.width <= 0 || img.height <= 0) return;
  const srcAR = img.width / img.height;
  const dstAR = dw / dh;

  // Cover rectangle inside the source that has the destination's aspect ratio.
  let coverW: number;
  let coverH: number;
  if (srcAR > dstAR) {
    coverH = img.height;
    coverW = Math.round(coverH * dstAR);
  } else {
    coverW = img.width;
    coverH = Math.round(coverW / dstAR);
  }
  const cx = (img.width - coverW) / 2;
  const cy = (img.height - coverH) / 2;

  // Apply scale: visible window is 1/scale of the cover rectangle.
  const sw = coverW / motion.scale;
  const sh = coverH / motion.scale;
  const roomX = coverW - sw;
  const roomY = coverH - sh;

  const sx = cx + roomX / 2 + (motion.offsetX * roomX) / 2;
  const sy = cy + roomY / 2 + (motion.offsetY * roomY) / 2;

  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

/**
 * Build ffmpeg `zoompan` expressions that produce the same motion as
 * `motionAt()` over `durationSec` at `fps`. The caller is responsible for
 * pre-cropping the input to the same aspect ratio as the output box (so
 * scale=1 corresponds to "show the whole input"); see filters.ts.
 *
 * The expressions reference zoompan's `on` (output frame counter) and `iw/ih`
 * (input width/height); `zoom` refers to the value of `z` for the current
 * frame.
 */
export interface MotionFfmpegExpr {
  zExpr: string;
  xExpr: string;
  yExpr: string;
  /** Per-input-frame duration, in OUTPUT frames. */
  durationFrames: number;
}

export function ffmpegMotionExpressions(
  preset: MotionPreset,
  durationSec: number,
  fps: number,
): MotionFfmpegExpr {
  const d = Math.max(1, Math.round(durationSec * fps));
  const r = `(on/(${d}-1))`;

  let zExpr: string;
  let offX: string;
  let offY: string;

  switch (preset) {
    case 'none':
      zExpr = '1';
      offX = '0';
      offY = '0';
      break;
    case 'slow_zoom_in':
      zExpr = `(1+0.08*${r})`;
      offX = '0';
      offY = '0';
      break;
    case 'slow_zoom_out':
      zExpr = `(1.08-0.08*${r})`;
      offX = '0';
      offY = '0';
      break;
    case 'pan_left':
      zExpr = '1.08';
      offX = `(0.7-1.4*${r})`;
      offY = '0';
      break;
    case 'pan_right':
      zExpr = '1.08';
      offX = `(-0.7+1.4*${r})`;
      offY = '0';
      break;
    case 'float_soft':
      zExpr = `(1.04+0.015*sin(${r}*2*PI))`;
      offX = `(0.3*sin(${r}*4*PI))`;
      offY = `(0.2*cos(${r}*2*PI))`;
      break;
  }

  // x = (iw/2) * (1 - 1/zoom) * (1 + offX) — see motion model derivation in
  // the file header. The same applies to y.
  const xExpr = `(iw/2)*(1-1/zoom)*(1+${offX})`;
  const yExpr = `(ih/2)*(1-1/zoom)*(1+${offY})`;

  return { zExpr, xExpr, yExpr, durationFrames: d };
}

export const MOTION_PRESETS: MotionPreset[] = [
  'none',
  'slow_zoom_in',
  'slow_zoom_out',
  'pan_left',
  'pan_right',
  'float_soft',
];

export const MOTION_LABEL: Record<MotionPreset, string> = {
  none: 'None (static)',
  slow_zoom_in: 'Slow Zoom In',
  slow_zoom_out: 'Slow Zoom Out',
  pan_left: 'Pan Left',
  pan_right: 'Pan Right',
  float_soft: 'Float Soft',
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
