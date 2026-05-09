import type { AnimationPreset } from './types';

/**
 * Lyric animation system.
 *
 * MODEL
 * =====
 * Each lyric chunk is divided into three phases:
 *   - enter (≤ ENTER_SEC, capped at chunkDur/3)
 *   - hold  (the rest)
 *   - exit  (≤ EXIT_SEC, capped at chunkDur/3)
 *
 * `animationStateAt(preset, chunkDur, tInChunk)` returns a single
 * AnimationState that drives all rendering — opacity, vertical offset,
 * scale, blur, and glow. The shared scene renderer applies it to the
 * lyric paint pass; both the preview canvas (sampled per RAF) and the
 * export overlay generator (sampled per keyframe) hit the same code path.
 *
 * Animations are intentionally subtle — no bounce, no shake, no over-
 * the-top TikTok meme moves. Music-shorts / Reels emotional tone.
 */

export interface AnimationState {
  /** 0..1, multiplied with canvas globalAlpha. */
  opacity: number;
  /** Vertical offset in canonical (1080×1920) px. Positive moves down. */
  translateY: number;
  /** Scale factor, 1 = at rest. Applied around the lyric anchor. */
  scale: number;
  /** Gaussian blur radius in canonical px. */
  blur: number;
  /** 0..1 — extra glow intensity for karaoke_glow / outline-style boosts. */
  glow: number;
}

export const ENTER_SEC = 0.42;
export const EXIT_SEC = 0.42;

/** Frame rate at which the export samples keyframes. */
export const ANIMATION_KEYFRAME_FPS = 15;

/** Static state — passed everywhere as the no-animation default. */
export const REST_STATE: AnimationState = {
  opacity: 1,
  translateY: 0,
  scale: 1,
  blur: 0,
  glow: 0,
};

export function isStaticAnimation(preset: AnimationPreset): boolean {
  return preset === 'none';
}

export function animationStateAt(
  preset: AnimationPreset,
  chunkDurationSec: number,
  tInChunk: number,
): AnimationState {
  if (preset === 'none' || chunkDurationSec <= 0) return REST_STATE;
  const t = clamp(tInChunk, 0, chunkDurationSec);
  const enterDur = Math.min(ENTER_SEC, chunkDurationSec / 3);
  const exitDur = Math.min(EXIT_SEC, chunkDurationSec / 3);
  const holdEnd = chunkDurationSec - exitDur;

  let phase: 'enter' | 'hold' | 'exit';
  let progress: number; // 0 → 1 visible
  if (t < enterDur) {
    phase = 'enter';
    progress = easeOutCubic(t / Math.max(enterDur, 1e-6));
  } else if (t < holdEnd) {
    phase = 'hold';
    progress = 1;
  } else {
    phase = 'exit';
    const r = (t - holdEnd) / Math.max(exitDur, 1e-6);
    progress = 1 - easeInCubic(clamp(r, 0, 1));
  }

  return computeStateForPreset(preset, progress, phase);
}

function computeStateForPreset(
  preset: AnimationPreset,
  progress: number,
  phase: 'enter' | 'hold' | 'exit',
): AnimationState {
  const inv = 1 - progress;
  switch (preset) {
    case 'none':
      return REST_STATE;
    case 'fade':
      return { ...REST_STATE, opacity: progress };
    case 'slide_up':
      return { ...REST_STATE, opacity: progress, translateY: inv * 36 };
    case 'slide_down':
      return { ...REST_STATE, opacity: progress, translateY: -inv * 36 };
    case 'blur_fade':
      return { ...REST_STATE, opacity: progress, blur: inv * 14 };
    case 'soft_pop':
      return { ...REST_STATE, opacity: progress, scale: 0.96 + 0.04 * progress };
    case 'karaoke_glow':
      // Glow fades in with the opacity, holds at full while the line is visible,
      // and fades out together. Phase argument lets us bias slightly higher
      // during hold.
      return {
        ...REST_STATE,
        opacity: progress,
        glow: phase === 'hold' ? 1 : progress,
      };
  }
}

/**
 * Compute keyframe sample times (relative to chunk start) and their time
 * windows for the export overlay generator.
 *
 * Returns a list of:
 *   {
 *     sampleSec:   when in the chunk to sample animation state from
 *     enableStart: time slot start (clip-relative when offset by chunk.start)
 *     enableEnd:   time slot end
 *   }
 *
 * For static / `none` preset we return a single keyframe spanning the whole
 * chunk to preserve the existing 1-PNG-per-chunk behavior.
 */
export interface KeyframeSlot {
  sampleSec: number;
  windowStart: number;
  windowEnd: number;
}

export function planKeyframes(
  preset: AnimationPreset,
  chunkDurationSec: number,
): KeyframeSlot[] {
  if (chunkDurationSec <= 0) return [];
  if (isStaticAnimation(preset)) {
    return [
      { sampleSec: chunkDurationSec / 2, windowStart: 0, windowEnd: chunkDurationSec },
    ];
  }
  const enterDur = Math.min(ENTER_SEC, chunkDurationSec / 3);
  const exitDur = Math.min(EXIT_SEC, chunkDurationSec / 3);
  const holdEnd = Math.max(enterDur, chunkDurationSec - exitDur);

  const enterCount = Math.max(1, Math.ceil(enterDur * ANIMATION_KEYFRAME_FPS));
  const exitCount = Math.max(1, Math.ceil(exitDur * ANIMATION_KEYFRAME_FPS));

  const slots: KeyframeSlot[] = [];
  // Enter keyframes — sample mid-window for visual smoothness.
  for (let i = 0; i < enterCount; i++) {
    const a = (i * enterDur) / enterCount;
    const b = ((i + 1) * enterDur) / enterCount;
    slots.push({ sampleSec: (a + b) / 2, windowStart: a, windowEnd: b });
  }
  // Hold — only emit if there's actually a hold window.
  if (holdEnd > enterDur) {
    slots.push({
      sampleSec: enterDur + (holdEnd - enterDur) / 2,
      windowStart: enterDur,
      windowEnd: holdEnd,
    });
  }
  // Exit keyframes.
  for (let j = 0; j < exitCount; j++) {
    const a = holdEnd + (j * exitDur) / exitCount;
    const b = holdEnd + ((j + 1) * exitDur) / exitCount;
    slots.push({ sampleSec: (a + b) / 2, windowStart: a, windowEnd: b });
  }
  return slots;
}

/* -------------------------------- easing -------------------------------- */

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - clamp(x, 0, 1), 3);
}

function easeInCubic(x: number): number {
  const c = clamp(x, 0, 1);
  return c * c * c;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/* ------------------------------- registry ------------------------------- */

export const ANIMATION_PRESETS: AnimationPreset[] = [
  'none',
  'fade',
  'slide_up',
  'slide_down',
  'blur_fade',
  'soft_pop',
  'karaoke_glow',
];

export const ANIMATION_LABEL: Record<AnimationPreset, string> = {
  none: 'None (static)',
  fade: 'Fade',
  slide_up: 'Slide Up',
  slide_down: 'Slide Down',
  blur_fade: 'Blur Fade',
  soft_pop: 'Soft Pop',
  karaoke_glow: 'Karaoke Glow',
};
