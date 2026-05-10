import type { AmplitudeCurve, ReactiveMode } from './types';

/**
 * Audio reactive system.
 *
 * MODEL
 * =====
 * A single pre-computed `AmplitudeCurve` (RMS-based, smoothed, percentile-
 * normalized) is the authority for both preview and export. Both call
 * `reactiveStateAt(mode, curve, t)` to get a `ReactiveState` for the moment
 * being rendered. Effects are intentionally subtle — vignette pulse, glow
 * boost, light bloom — never EDM-spectrum or RGB strobe.
 *
 * Reactive effects are applied entirely inside the canvas overlay layer
 * (the lyric/meta PNGs), so they live on top of motion + lyric animation
 * with no extra ffmpeg machinery needed.
 */

export interface ReactiveState {
  /** Raw 0..1 amplitude after percentile normalization. */
  intensity: number;
  /** 0..1 — gentle vignette/scale pulse strength. */
  pulse: number;
  /** 0..1 — extra glow boost layered onto lyrics / neon frame. */
  glow: number;
  /** 0..1 — outer bloom haze (cinematic mode). */
  bloom: number;
  /** 0..1 — waveform amplitude boost (consumed by chrome painter). */
  waveformBoost: number;
}

export const REST_REACTIVE: ReactiveState = {
  intensity: 0,
  pulse: 0,
  glow: 0,
  bloom: 0,
  waveformBoost: 0,
};

export function isStaticReactive(mode: ReactiveMode): boolean {
  return mode === 'none';
}

/**
 * Sample the amplitude curve at clip-relative time `tSec`. The curve is
 * indexed by `floor(t / intervalSec)` with a minor linear interpolation to
 * the next bucket so the result evolves smoothly across sample boundaries.
 */
export function sampleAmplitude(curve: AmplitudeCurve | null | undefined, tSec: number): number {
  if (!curve || curve.values.length === 0 || curve.intervalSec <= 0) return 0;
  const f = tSec / curve.intervalSec;
  const i = Math.floor(f);
  const frac = f - i;
  const a = curve.values[clampIdx(i, curve.values.length)] ?? 0;
  const b = curve.values[clampIdx(i + 1, curve.values.length)] ?? a;
  return clamp01(a * (1 - frac) + b * frac);
}

export function reactiveStateAt(
  mode: ReactiveMode,
  curve: AmplitudeCurve | null | undefined,
  tSec: number,
): ReactiveState {
  if (isStaticReactive(mode) || !curve) return REST_REACTIVE;
  const intensity = sampleAmplitude(curve, tSec);
  switch (mode) {
    case 'none':
      return REST_REACTIVE;
    case 'soft_pulse':
      return {
        intensity,
        pulse: intensity * 0.55,
        glow: intensity * 0.15,
        bloom: 0,
        waveformBoost: 0,
      };
    case 'lyric_glow':
      return {
        intensity,
        pulse: 0,
        glow: intensity * 0.85,
        bloom: 0,
        waveformBoost: 0,
      };
    case 'waveform_boost':
      return {
        intensity,
        pulse: intensity * 0.2,
        glow: 0,
        bloom: 0,
        waveformBoost: intensity * 0.7,
      };
    case 'cinematic_bloom':
      return {
        intensity,
        pulse: intensity * 0.25,
        glow: 0,
        bloom: intensity * 0.6,
        waveformBoost: 0,
      };
    case 'neon_pulse':
      return {
        intensity,
        pulse: intensity * 0.35,
        glow: intensity * 0.9,
        bloom: intensity * 0.3,
        waveformBoost: 0,
      };
  }
}

/* ---------------------------- analysis helpers ---------------------------- */

/**
 * Compute an AmplitudeCurve from a Float32 PCM buffer.
 * - `sampleRate`: samples per second of the input PCM.
 * - `intervalSec`: time bucket size for the output curve (e.g., 0.05s).
 * Smooths via centered moving average, then normalizes against the 95th
 * percentile so a single peak doesn't crush everything else to zero.
 */
export function buildAmplitudeCurve(
  pcm: Float32Array,
  sampleRate: number,
  durationSec: number,
  intervalSec = 0.05,
): AmplitudeCurve {
  if (sampleRate <= 0 || pcm.length === 0 || intervalSec <= 0) {
    return { intervalSec, values: [], durationSec: 0 };
  }
  const windowLen = Math.max(1, Math.round(sampleRate * intervalSec));
  const numBuckets = Math.floor(pcm.length / windowLen);
  const rms = new Float64Array(numBuckets);
  for (let b = 0; b < numBuckets; b++) {
    const base = b * windowLen;
    let sumSq = 0;
    for (let i = 0; i < windowLen; i++) {
      const v = pcm[base + i];
      sumSq += v * v;
    }
    rms[b] = Math.sqrt(sumSq / windowLen);
  }
  const smoothed = movingAverage(rms, 3);
  const normalized = percentileNormalize(smoothed, 0.95);
  return {
    intervalSec,
    values: Array.from(normalized),
    durationSec,
  };
}

function movingAverage(arr: Float64Array, halfWidth: number): Float64Array {
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0;
    let n = 0;
    const lo = Math.max(0, i - halfWidth);
    const hi = Math.min(arr.length - 1, i + halfWidth);
    for (let j = lo; j <= hi; j++) {
      sum += arr[j];
      n++;
    }
    out[i] = sum / Math.max(1, n);
  }
  return out;
}

function percentileNormalize(arr: Float64Array, percentile: number): Float64Array {
  if (arr.length === 0) return arr;
  const sorted = Array.from(arr).sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * percentile)));
  const denom = sorted[idx] || 1e-9;
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    out[i] = clamp01(arr[i] / denom);
  }
  return out;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clampIdx(i: number, len: number): number {
  return Math.max(0, Math.min(len - 1, i));
}

/* ------------------------------- registry ------------------------------- */

export const REACTIVE_MODES: ReactiveMode[] = [
  'none',
  'soft_pulse',
  'lyric_glow',
  'waveform_boost',
  'cinematic_bloom',
  'neon_pulse',
];

export const REACTIVE_LABEL: Record<ReactiveMode, string> = {
  none: '없음',
  soft_pulse: '부드러운 박동',
  lyric_glow: '가사 글로우',
  waveform_boost: '웨이브폼 강조',
  cinematic_bloom: '시네마틱 빛 번짐',
  neon_pulse: '네온 박동',
};
