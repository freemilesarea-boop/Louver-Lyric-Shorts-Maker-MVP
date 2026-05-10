import type { FxPreset, Template } from './types';

/**
 * Cinematic FX pack.
 *
 * The pack ships a small library of preset bundles (clean_cinematic,
 * subtle_bloom, dust_grain, aberration_grain, …) that map to a single
 * `FxConfig` — the per-effect intensity. Both preview and export call
 * `paintCinematicFx(ctx, config, seed, template)` so the layered noise,
 * vignette, halo, etc. look identical in both places.
 *
 * Tone is intentionally subtle — premium / Reels / film grain — never
 * glitch-meme territory.
 */

export interface FxConfig {
  /** Animated monochrome grain intensity. 0..1. */
  grain: number;
  /** Edge darkening (radial). 0..1. */
  vignette: number;
  /** Subtle RGB stripe at the left/right edges. 0..1. */
  aberration: number;
  /** Additive accent-color halo. 0..1. */
  bloom: number;
  /** Sparse dust speck count multiplier. 0..1. */
  dust: number;
  /** Warm light leak from the upper-right corner. 0..1. */
  lightLeak: number;
  /** Soft top/bottom feather for a dreamy look. 0..1. */
  softBlur: number;
}

export const FX_REST: FxConfig = {
  grain: 0,
  vignette: 0,
  aberration: 0,
  bloom: 0,
  dust: 0,
  lightLeak: 0,
  softBlur: 0,
};

export function isStaticFx(c: FxConfig): boolean {
  return (
    c.grain <= 0 &&
    c.vignette <= 0 &&
    c.aberration <= 0 &&
    c.bloom <= 0 &&
    c.dust <= 0 &&
    c.lightLeak <= 0 &&
    c.softBlur <= 0
  );
}

export function fxConfigForPreset(preset: FxPreset): FxConfig {
  switch (preset) {
    case 'none':
      return FX_REST;
    case 'clean_cinematic':
      return { ...FX_REST, vignette: 0.22, grain: 0.05 };
    case 'subtle_bloom':
      return { ...FX_REST, bloom: 0.32, vignette: 0.14, grain: 0.04 };
    case 'soft_blur':
      return { ...FX_REST, softBlur: 0.45, vignette: 0.12, bloom: 0.12 };
    case 'dust_grain':
      return { ...FX_REST, grain: 0.16, dust: 0.4, vignette: 0.18, lightLeak: 0.08 };
    case 'aberration_grain':
      return { ...FX_REST, grain: 0.22, aberration: 0.32, vignette: 0.22 };
    case 'bloom_neon':
      return { ...FX_REST, bloom: 0.42, lightLeak: 0.18, vignette: 0.18, grain: 0.06 };
    case 'film_texture':
      return { ...FX_REST, grain: 0.18, dust: 0.3, lightLeak: 0.28, vignette: 0.22 };
  }
}

/* ---------------------------- canvas painters ---------------------------- */

/**
 * Paint all FX layers in order. `seed` is an integer that drives the noise/
 * dust placement — both preview (RAF tick) and export (keyframe time index)
 * pass the same seed for the same moment so frames stay in sync.
 *
 * Caller is responsible for ensuring (ctx.canvas.width, ctx.canvas.height)
 * == (width, height) — this function paints in canonical 1080×1920 space
 * after being called inside the same scaled transform as the rest of the
 * scene renderer.
 */
export function paintCinematicFx(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cfg: FxConfig,
  seed: number,
  template: Pick<Template, 'lyricSubColor' | 'glowColor'>,
): void {
  if (isStaticFx(cfg)) return;

  // Order matters: vignette → soft blur → bloom → light leak → aberration →
  // dust → grain. Grain on top so its texture sits on the final composite.
  if (cfg.vignette > 0) paintVignette(ctx, width, height, cfg.vignette);
  if (cfg.softBlur > 0) paintSoftBlur(ctx, width, height, cfg.softBlur);
  if (cfg.bloom > 0) paintBloom(ctx, width, height, cfg.bloom, template.glowColor ?? template.lyricSubColor);
  if (cfg.lightLeak > 0) paintLightLeak(ctx, width, height, cfg.lightLeak);
  if (cfg.aberration > 0) paintAberration(ctx, width, height, cfg.aberration);
  if (cfg.dust > 0) paintDust(ctx, width, height, cfg.dust, seed);
  if (cfg.grain > 0) paintGrain(ctx, width, height, cfg.grain, seed);
}

function paintVignette(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const inner = Math.min(w, h) * 0.45;
  const outer = Math.max(w, h) * 0.85;
  const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(0,0,0,${(0.55 * intensity).toFixed(3)})`);
  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function paintSoftBlur(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number): void {
  // Top and bottom feather — emulates dream-haze edges without needing a
  // multi-pass blur (which is expensive in 2D canvas).
  const feather = Math.round(h * 0.18 * intensity);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const top = ctx.createLinearGradient(0, 0, 0, feather);
  top.addColorStop(0, `rgba(255,255,255,${(0.18 * intensity).toFixed(3)})`);
  top.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, feather);
  const bot = ctx.createLinearGradient(0, h - feather, 0, h);
  bot.addColorStop(0, 'rgba(255,255,255,0)');
  bot.addColorStop(1, `rgba(255,255,255,${(0.18 * intensity).toFixed(3)})`);
  ctx.fillStyle = bot;
  ctx.fillRect(0, h - feather, w, feather);
  ctx.restore();
}

function paintBloom(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  intensity: number,
  accent: string,
): void {
  const cx = w / 2;
  const cy = h * 0.45;
  const radius = Math.max(w, h) * 0.6;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  grad.addColorStop(0, withAlpha(accent, 0.18 * intensity));
  grad.addColorStop(0.45, withAlpha(accent, 0.08 * intensity));
  grad.addColorStop(1, withAlpha(accent, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function paintLightLeak(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number): void {
  // Warm leak from the upper-right corner sweeping across the frame.
  const grad = ctx.createRadialGradient(w * 0.92, h * 0.08, 0, w * 0.92, h * 0.08, w * 0.95);
  grad.addColorStop(0, `rgba(255, 175, 90, ${(0.55 * intensity).toFixed(3)})`);
  grad.addColorStop(0.4, `rgba(255, 130, 100, ${(0.15 * intensity).toFixed(3)})`);
  grad.addColorStop(1, 'rgba(255, 130, 100, 0)');
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function paintAberration(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number): void {
  // Cheap edge-only RGB shift approximation. Two thin colored strips on the
  // outer left and right margins, blended with `screen`. No re-rendering of
  // the underlying scene — keeps this affordable per keyframe.
  const inset = Math.max(8, Math.round(w * 0.012 * intensity));
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  // Red on the left (channel pulled outward).
  const leftGrad = ctx.createLinearGradient(0, 0, inset, 0);
  leftGrad.addColorStop(0, `rgba(255,40,40,${(0.4 * intensity).toFixed(3)})`);
  leftGrad.addColorStop(1, 'rgba(255,40,40,0)');
  ctx.fillStyle = leftGrad;
  ctx.fillRect(0, 0, inset, h);
  // Cyan on the right.
  const rightGrad = ctx.createLinearGradient(w - inset, 0, w, 0);
  rightGrad.addColorStop(0, 'rgba(40,200,255,0)');
  rightGrad.addColorStop(1, `rgba(40,200,255,${(0.4 * intensity).toFixed(3)})`);
  ctx.fillStyle = rightGrad;
  ctx.fillRect(w - inset, 0, inset, h);
  ctx.restore();
}

function paintDust(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  intensity: number,
  seed: number,
): void {
  const count = Math.round(80 * intensity);
  const rand = mulberry32(seed ^ 0x9e3779b9);
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 0.8 + rand() * 3.5;
    const alpha = 0.25 + rand() * 0.45;
    ctx.fillStyle = `rgba(255, 248, 230, ${(alpha * intensity).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function paintGrain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  intensity: number,
  seed: number,
): void {
  // Sparse monochrome speckle. Tuned to ~0.0007 dots/px at intensity=1 so a
  // 1080x1920 frame draws ~1450 dots — fast enough for 30fps preview yet
  // still gives a noticeable film grain texture.
  const count = Math.round(w * h * 0.0007 * intensity);
  const rand = mulberry32(seed ^ 0x85ebca6b);
  const alpha = 0.55 * intensity;
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = (rand() * w) | 0;
    const y = (rand() * h) | 0;
    const v = 90 + ((rand() * 165) | 0);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha.toFixed(3)})`;
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.restore();
}

/* -------------------------------- helpers -------------------------------- */

/** Tiny deterministic PRNG — same seed = same output. */
function mulberry32(seed: number) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  if (color.startsWith('rgba(') || color.startsWith('rgb(')) {
    const m = color.match(/^rgba?\(([^)]+)\)$/);
    if (!m) return color;
    const [r, g, b] = m[1].split(',').map((s) => s.trim());
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  const cleaned = color.startsWith('#') ? color.slice(1) : color;
  if (cleaned.length !== 6) return color;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/* ------------------------------- registry ------------------------------- */

export const FX_PRESETS: FxPreset[] = [
  'none',
  'clean_cinematic',
  'subtle_bloom',
  'soft_blur',
  'dust_grain',
  'aberration_grain',
  'bloom_neon',
  'film_texture',
];

export const FX_LABEL: Record<FxPreset, string> = {
  none: '없음',
  clean_cinematic: '깨끗한 시네마',
  subtle_bloom: '은은한 빛 번짐',
  soft_blur: '부드러운 블러',
  dust_grain: '먼지 + 그레인',
  aberration_grain: '색수차 + 그레인',
  bloom_neon: '네온 빛 번짐',
  film_texture: '필름 질감',
};
