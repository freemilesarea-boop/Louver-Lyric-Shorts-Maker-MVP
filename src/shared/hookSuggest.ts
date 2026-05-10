import type { AmplitudeCurve } from './types';
import { sampleAmplitude } from './audioReactive';

/**
 * Hook section auto-suggest.
 *
 * Reuses the amplitude curve that audioReactive.ts already computes for
 * the reactive system, so this feature costs ~0 extra CPU. The score
 * combines:
 *   - average energy in the window
 *   - penalty for windows that are mostly silent (false-positive intros)
 *   - bonus for amplitude that rises into the second half (build-ups
 *     and choruses)
 *
 * Strictly amplitude-based. No BPM, no chorus detection, no Whisper —
 * the goal is "hand the user 1-3 candidates worth auditioning," not
 * solve music structure.
 */

export interface HookCandidate {
  startSec: number;
  endSec: number;
  /** 0..1 — higher = more likely a "good" hook section. */
  energyScore: number;
}

export interface HookSuggestOptions {
  /** Maximum number of candidates to return. Default 3. */
  maxCandidates?: number;
  /** Sliding-window step in seconds. Default 1. */
  stepSec?: number;
  /** Minimum gap between candidate start times. Default = targetLength × 0.6. */
  minSeparationSec?: number;
}

export function suggestHookSections(
  curve: AmplitudeCurve | null | undefined,
  audioDurationSec: number,
  targetLengthSec: number,
  opts: HookSuggestOptions = {},
): HookCandidate[] {
  if (!curve || curve.values.length === 0) return [];
  if (targetLengthSec <= 0 || audioDurationSec <= 0) return [];

  const max = opts.maxCandidates ?? 3;
  const step = Math.max(0.1, opts.stepSec ?? 1);
  const minSep = opts.minSeparationSec ?? targetLengthSec * 0.6;

  // Audio shorter than target — return a single full-coverage candidate.
  if (audioDurationSec <= targetLengthSec) {
    return [
      {
        startSec: 0,
        endSec: audioDurationSec,
        energyScore: scoreWindow(curve, 0, audioDurationSec),
      },
    ];
  }

  const lastStart = audioDurationSec - targetLengthSec;
  const scored: { startSec: number; score: number }[] = [];
  for (let s = 0; s <= lastStart + 1e-6; s += step) {
    scored.push({ startSec: s, score: scoreWindow(curve, s, targetLengthSec) });
  }

  // Greedy non-overlapping selection — pick highest score, then exclude any
  // window starting within `minSep` seconds of an already-picked candidate.
  scored.sort((a, b) => b.score - a.score);
  const picked: HookCandidate[] = [];
  for (const c of scored) {
    if (picked.length >= max) break;
    if (picked.some((p) => Math.abs(p.startSec - c.startSec) < minSep)) continue;
    if (c.score <= 0.05) break; // skip near-silent windows
    picked.push({
      startSec: c.startSec,
      endSec: c.startSec + targetLengthSec,
      energyScore: c.score,
    });
  }
  // Display order = chronological, so the user can compare easily.
  picked.sort((a, b) => a.startSec - b.startSec);
  return picked;
}

/**
 * Score a single time window. Returns a value in [0, 1] where higher is
 * more "hook-worthy". Pure amplitude — no spectral analysis.
 */
export function scoreWindow(
  curve: AmplitudeCurve,
  startSec: number,
  lengthSec: number,
): number {
  const samples = sampleWindow(curve, startSec, lengthSec);
  if (samples.length === 0) return 0;

  const sum = samples.reduce((a, b) => a + b, 0);
  const avg = sum / samples.length;

  // Penalize windows where >40% of samples are essentially silent — those
  // tend to be intros or breakdowns rather than hooks.
  const silentRatio = samples.filter((v) => v < 0.1).length / samples.length;
  const silencePenalty = Math.min(0.5, silentRatio * 0.6);

  // Bonus for build-up: if the second half is louder than the first by a
  // meaningful margin, give a small score boost — that pattern usually
  // means a chorus drops in the back half of the window.
  const half = Math.max(1, Math.floor(samples.length / 2));
  const firstHalf = samples.slice(0, half);
  const secondHalf = samples.slice(half);
  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / Math.max(1, secondHalf.length);
  const riseBonus = Math.max(0, Math.min(0.15, (secondAvg - firstAvg) * 0.7));

  return clamp01(avg * (1 - silencePenalty) + riseBonus);
}

function sampleWindow(curve: AmplitudeCurve, startSec: number, lengthSec: number): number[] {
  const out: number[] = [];
  const step = curve.intervalSec;
  for (let t = startSec; t < startSec + lengthSec; t += step) {
    out.push(sampleAmplitude(curve, t));
  }
  return out;
}

/** mm:ss formatter for the candidate UI. */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
