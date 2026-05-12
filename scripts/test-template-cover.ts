/**
 * Template anti-cover smoke.
 *
 * For every shipped template, render an export-mode keyframe overlay
 * PNG over a high-contrast checkerboard "photo" and confirm the user's
 * photo would still be visible — i.e. the overlay is NOT a solid
 * opaque rectangle covering the photo region.
 *
 * The check: sample a 4×4 grid of points inside the central photo
 * area on the rendered overlay. If every sampled pixel is fully
 * opaque AND clusters within a tiny RGB radius (≤ 8), the painter
 * has effectively painted an opaque cover. That's the regression we
 * had with paintFrame 'rounded' (fill) before Phase 5-3.3.
 *
 * This catches BOTH the original symptom (huge fillRect masking the
 * photo) and softer regressions (e.g. someone re-introducing a card
 * fill with low alpha that still hides texture detail).
 *
 * Run:  npx tsx scripts/test-template-cover.ts
 */

import { createCanvas } from '@napi-rs/canvas';
import { renderScene, SCENE_W, SCENE_H } from '../src/shared/scene.ts';
import { templates } from '../src/renderer/templates/templates.ts';

let allOk = true;
const ok = (label: string, cond: boolean, extra = ''): void => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${extra ? ' · ' + extra : ''}`);
  if (!cond) allOk = false;
};

interface SamplePoint {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Sample a 4×4 grid inside the central 60%×50% region of the canvas.
 * That window matches the user-facing photo area at 92%×74% with some
 * margin for frame borders that legitimately strike through the edges.
 */
function sampleCenterPixels(buf: Uint8ClampedArray): SamplePoint[] {
  const xMin = Math.round(SCENE_W * 0.20);
  const xMax = Math.round(SCENE_W * 0.80);
  const yMin = Math.round(SCENE_H * 0.20);
  const yMax = Math.round(SCENE_H * 0.70);
  const samples: SamplePoint[] = [];
  const cols = 4;
  const rows = 4;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = Math.round(xMin + ((xMax - xMin) * (cx + 0.5)) / cols);
      const y = Math.round(yMin + ((yMax - yMin) * (cy + 0.5)) / rows);
      const idx = (y * SCENE_W + x) * 4;
      samples.push({
        x, y,
        r: buf[idx],
        g: buf[idx + 1],
        b: buf[idx + 2],
        a: buf[idx + 3],
      });
    }
  }
  return samples;
}

/**
 * Returns true if every sample is fully opaque AND every sample's RGB
 * is within `tol` of the first sample's RGB. That signature = solid
 * fill covering the photo region.
 */
function isOpaqueCover(samples: SamplePoint[], tol = 8): boolean {
  if (samples.length === 0) return false;
  const allOpaque = samples.every((s) => s.a >= 250);
  if (!allOpaque) return false;
  const first = samples[0];
  const allClose = samples.every(
    (s) =>
      Math.abs(s.r - first.r) <= tol &&
      Math.abs(s.g - first.g) <= tol &&
      Math.abs(s.b - first.b) <= tol,
  );
  return allClose;
}

console.log('--- Template anti-cover (export-mode keyframe overlay) ---');

for (const t of templates) {
  const canvas = createCanvas(SCENE_W, SCENE_H);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, SCENE_W, SCENE_H);

  // Render in export mode (no bg, no foreground card — this is what each
  // per-line keyframe PNG looks like before ffmpeg overlays it on the
  // photo). The photo will be ffmpeg-painted underneath.
  renderScene(ctx as unknown as CanvasRenderingContext2D, {
    width: SCENE_W,
    height: SCENE_H,
    template: t,
    language: 'en',
    highlightSub: false,
    exportMode: true,
    lyric: { text: 'Just breathe' },
    durationSec: 15,
    timeRatio: 0.3,
  });

  const data = ctx.getImageData(0, 0, SCENE_W, SCENE_H).data;
  const samples = sampleCenterPixels(data);
  const cover = isOpaqueCover(samples);
  // Show the dominant sampled color in the center for diagnostic context.
  const tag = `center≈rgba(${samples[0].r},${samples[0].g},${samples[0].b},${samples[0].a})`;
  ok(`[${t.id}] photo region not covered by opaque rect`, !cover, tag);
}

console.log(`\n${allOk ? 'ALL TEMPLATES SAFE' : 'SOME TEMPLATES STILL COVER THE PHOTO'}`);
process.exit(allOk ? 0 : 1);
